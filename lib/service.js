// @ts-check
const {Elf} = require('xcraft-core-goblin');
const {string, object} = require('xcraft-core-stones');
const {Readable} = require('stream');
const path = require('node:path');
const {encryptStream, decryptStream} = require('./crypto.js');
const Goblin = require('xcraft-core-goblin');
const enstore = require('enstore');
const {
  publicMethods,
  readEncryptionKey,
  parseJsonFromStream,
} = require('./utils.js');
const devMode = process.env.NODE_ENV === 'development';

class TradingpostShape {
  id = string;
  trading = object;
}

class TradingpostState extends Elf.Sculpt(TradingpostShape) {}

class TradingpostLogic extends Elf.Spirit {
  state = new TradingpostState();

  create(id) {
    this.state.id = id;
    this.state.trading = {};
  }

  addGoblinApi(goblinId, infos) {
    this.state.trading[goblinId] = infos;
  }

  removeGoblinApi(goblinId) {
    delete this.state.trading[goblinId];
  }
}

class Tradingpost extends Elf {
  logic = Elf.getLogic(TradingpostLogic);
  state = new TradingpostState();

  _host;
  _port;
  _address;
  _fastify;

  async create(
    id,
    desktopId,
    host = '127.0.0.1',
    port = 8080,
    exposeSwagger = devMode,
    swaggerServerUrl = 'http://127.0.0.1:8080',
    activateLogger = devMode,
    schemas,
    tags = []
  ) {
    this._host = host;
    this._port = port;
    this.logic.create(id);
    const fastify = require('fastify')({
      logger: activateLogger,
    });

    if (schemas) {
      for (const schema of schemas) {
        //note: addSchema cannot fail here, validation occur when fastify starts
        fastify.addSchema(schema);
      }
    }

    // HACK: close the handles when the process is exiting
    process.on('SIGINT', () => {
      fastify.close();
    });

    const formPlugin = (fastify, options, next) => {
      const {parse} = require('querystring'); //nodejs built-in
      const contentParser = (req, body, done) => {
        done(null, parse(body.toString()));
      };
      fastify.addContentTypeParser(
        'application/x-www-form-urlencoded',
        {parseAs: 'buffer'},
        contentParser
      );
      next();
    };
    const fp = require('fastify-plugin');
    await fastify.register(
      fp(formPlugin, {
        fastify: '^4.0.0',
        name: 'fastify-formbody',
      }),
      {}
    );

    const hostUrl = `http://${host}:${port}/`;

    await fastify.register(require('@fastify/cors'), {
      // TODO: add options to specify things,
      // by default, seams to allows any origin
    });

    await fastify.register(require('@fastify/swagger'), {
      openapi: {
        info: {
          title: 'Goblin Trading Post',
          description: '',
          version: this.quest.getAPI('tradingpost').version,
        },
        host: hostUrl,
        servers: [
          {
            url: swaggerServerUrl,
            description: devMode ? `dev server` : 'release server',
          },
        ],
        tags,
        schemes: ['http', 'https'],
        consumes: ['application/json', 'text/plain'],
        produces: ['application/json', 'text/plain'],
        security: [],
        components: {
          securitySchemes: {
            apiKey: {
              type: 'apiKey',
              in: 'header',
              name: 'apiKey',
              description: 'API key to authorize requests',
            },
          },
        },
      },
    });

    if (exposeSwagger) {
      await fastify.register(require('@fastify/swagger-ui'), {
        routePrefix: '/docs',
      });
    }

    this._fastify = fastify;
  }

  async start() {
    let currentAddress = this._address;
    if (currentAddress) {
      this.log.dbg(
        `Fastify server already started on address: ${currentAddress} !`
      );
      return currentAddress;
    }

    const goblinCount = Object.keys(this.state.trading).length;
    if (goblinCount === 0) {
      throw Error(
        "Fastify server can't start without at least one goblin API !"
      );
    }

    const fastify = this._fastify;
    // Set keep alive timeout to 120 secondes
    fastify.server.keepAliveTimeout = 120000;

    // Start fastify server after you regitered goblin API
    await fastify.ready();
    fastify.swagger();
    const host = this._host;
    const port = this._port;
    try {
      currentAddress = await fastify.listen(port, host);
      this.log.dbg(`Fastify server started on address: ${currentAddress}`);
    } catch (err) {
      throw new Error(`Error when starting fastify server : ${err}`);
    }

    this._address = currentAddress;

    // Return string to format : http://${host}:${port}
    return currentAddress;
  }

  async addGoblinApi(
    goblinId,
    apiKey = [],
    apiVersion = null,
    allowedCommands = {},
    secure = null
  ) {
    let currentAddress = this._address;

    if (currentAddress) {
      throw Error(
        `Fastify server already started on address: ${currentAddress} ! Close server first if you want to add other goblin API`
      );
    }

    const fastify = this._fastify;

    let info = {allowedCommands, keyPath: secure};

    if (secure) {
      info.encryptionKey = readEncryptionKey(secure);
      fastify.addContentTypeParser('application/octet-stream', function (
        request,
        payload,
        done
      ) {
        const store = enstore();
        const storeStream = store.createWriteStream();
        const decryptedStream = decryptStream(payload, info.encryptionKey);
        decryptedStream.pipe(storeStream);
        decryptedStream.on('end', () => done(null, store.createReadStream()));
      });
    }

    this.logic.addGoblinApi(goblinId, info);

    // Building route for exposed quests

    const goblinAPI = this.quest.getAPI(goblinId);

    const log = this.log;

    const allowedCommandsName = Object.keys(allowedCommands);

    publicMethods(goblinAPI)
      .filter((item) => allowedCommandsName.includes(item))
      .forEach((questName) => {
        // reset default values
        log.dbg(`register quest '${goblinId}/${questName}' to HTTP server`);
        //const cmdRegistry = quest.resp.getCommandsRegistry();
        //const currentCmd = cmdRegistry[`${goblinIdName}.${questName}`];
        //if (currentCmd) {
        //  params = currentCmd.options.params;
        //}

        const params = allowedCommands[questName].params || null;
        const body = allowedCommands[questName].body || null;
        const queryString = allowedCommands[questName].queryString || null;
        const defaultHttpCode = allowedCommands[questName].httpCode || 200;

        let responses = {};
        if (allowedCommands[questName].response) {
          responses[defaultHttpCode] = allowedCommands[questName].response;
        } else if (allowedCommands[questName].responses) {
          responses = allowedCommands[questName].responses;
        }

        if (apiKey.length > 0) {
          responses[401] = {
            type: 'string',
            description: 'API key is missing or invalid',
          };
        }

        const schemaParametersKind = {};
        if (params) {
          schemaParametersKind.params = params;
        }
        if (body) {
          schemaParametersKind.body = body;
        }

        if (queryString) {
          schemaParametersKind.querystring = queryString;
        }

        const schema = {
          summary: allowedCommands[questName].summary || questName,
          description: allowedCommands[questName].description || '',
          tags: allowedCommands[questName].tags || [goblinId],
          response: responses,
          security: [
            {
              apiKey,
            },
          ],
          ...schemaParametersKind,
        };

        let verb = allowedCommands[questName].verb || 'PUT';
        verb = verb.toUpperCase();

        let additionRouteArgs = {};
        if (verb !== 'GET') {
          additionRouteArgs.body = {};
        }
        const route =
          allowedCommands[questName].route || `${goblinId}/${questName}`;

        let url = `/${route}`;
        if (apiVersion) {
          url = `/${apiVersion}/${route}`;
        }

        const handleRequest = async function (request) {
          try {
            let response;

            if (apiKey.length > 0 && !request.headers.apikey) {
              return {code: 401, payload: 'Unauthorized'};
            }

            if (apiKey.length > 0) {
              const key = request.headers.apikey;
              if (!apiKey.includes(key)) {
                return {code: 401, payload: 'Unauthorized'};
              }
            }

            let questParams;

            if (queryString) {
              questParams = {...request.query};
            }

            if (body) {
              // request.body is a stream
              if (request.body instanceof Readable) {
                if (body.type === 'object') {
                  request.body = await parseJsonFromStream(request.body);
                } else if (body.type === 'stream') {
                  request.body = {stream: request.body};
                } else {
                  throw new Error('Error: body type not Implemented !');
                }
              }
              questParams = {...questParams, ...request.body};
            }

            if (params) {
              questParams = {...questParams, ...request.params};
            }
            try {
              response = await goblinAPI[questName](questParams);

              //no content case
              if (!response) {
                return {code: 204, payload: ''};
              }

              //dedicated http response
              if (response.httpCode) {
                return {
                  code: response.httpCode,
                  payload: response.httpResponse || '',
                };
              } else {
                //default response
                if (!allowedCommands[questName].contentType) {
                  allowedCommands[questName].contentType = 'application/json';
                }
                const contentType = [];

                contentType.push(allowedCommands[questName].contentType);
                contentType.push('charset=utf-8');
                return {
                  code: defaultHttpCode,
                  payload: response,
                  headers: [['Content-Type', contentType.join(';')]],
                };
              }
            } catch (err) {
              return {
                code: 500,
                payload: `Internal Server Error: error in quest ${questName}`,
              };
            }
          } catch (e) {
            return {
              code: 500,
              payload: 'Internal Server Error',
            };
          }
        };
        fastify.route({
          method: verb,
          url,
          schema,
          handler: async function (request, reply) {
            let {code, payload, headers = null} = await handleRequest(request);
            reply.code(code);
            if (headers) {
              headers.forEach(([key, value]) => reply.header(key, value));
            }
            if (secure) {
              reply.header('Content-Type', 'application/octet-stream');
              // transform payload to stream if it's not already one
              if (!(payload instanceof Readable)) {
                payload = Readable.from(Buffer.from(payload));
              }
              // Encrypt and send payload response as stream
              payload = await encryptStream(payload, info.encryptionKey);
            }
            reply.send(payload);
          },
          ...additionRouteArgs,
        });
      });
  }

  async restart() {
    // Close current instance
    await this.close();
    const goblinIds = Object.entries(this.state.trading);
    for (const [id, config] of goblinIds) {
      await this.addGoblinApi(id, config);
    }
    const currentAddress = await this.start();
    return currentAddress;
  }

  async close() {
    let currentAddress = this._address;
    if (currentAddress) {
      const fastify = this._fastify;
      this._address = null;
      this.log.info(`Fastify server "${currentAddress}" closing...`);
      await fastify.close();
      this._fastify = null;
    }
  }

  async removeGoblinApi(goblinId) {
    this.logic.removeGoblinApi(goblinId);
  }

  async delete() {
    await this.close();
  }
}

module.exports = {
  Tradingpost,
  TradingpostLogic,
};
