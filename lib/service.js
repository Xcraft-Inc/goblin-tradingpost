const {Readable} = require('stream');
const path = require('path');

const goblinName = path.basename(module.parent.filename, '.js');
const {encryptStream, decryptStream} = require('./crypto.js');
const Goblin = require('xcraft-core-goblin');
const enstore = require('enstore');
const watt = require('gigawatts');
const {
  publicMethods,
  readEncryptionKey,
  parseJsonFromStream,
} = require('./utils.js');

const devMode = process.env.NODE_ENV === 'development';

// Define initial logic values
const logicState = {
  id: goblinName,
  trading: {},
};

// Define logic handlers according rc.json
const logicHandlers = {
  'create': (state, action) => {
    return state.set('id', action.get('id'));
  },
  'change': (state, action) => {
    return state.set(action.get('path'), action.get('newValue'));
  },
  'delete-state': (state, action) => {
    return state.delete(action.get('path'));
  },
};

Goblin.registerQuest(goblinName, 'change', function (quest) {
  quest.do();
});

Goblin.registerQuest(goblinName, 'delete-state', function (quest) {
  quest.do();
});

Goblin.registerQuest(goblinName, 'create', async function (
  quest,
  host = '127.0.0.1',
  port = 8080,
  exposeSwagger = devMode,
  swaggerServerUrl = 'http://127.0.0.1:8080',
  activateLogger = devMode,
  schemas
) {
  quest.goblin.setX('host', host);
  quest.goblin.setX('port', port);

  quest.do();
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
        version: quest.getAPI(goblinName).version,
      },
      host: hostUrl,
      servers: [
        {
          url: swaggerServerUrl,
          description: devMode ? `dev server` : 'release server',
        },
      ],

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

  quest.goblin.setX('fastify', fastify);
});

Goblin.registerQuest(goblinName, 'add-goblin-api', function* (
  quest,
  goblinId,
  apiKey = [],
  apiVersion = null,
  allowedCommands = {},
  secure = null
) {
  let currentAddress = quest.goblin.getX('address');

  if (currentAddress) {
    throw Error(
      `Fastify server already started on address: ${currentAddress} ! Close server first if you want to add other goblin API`
    );
  }

  const fastify = quest.goblin.getX('fastify');

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

  yield quest.me.change({
    path: `trading.${goblinId}`,
    newValue: info,
  });

  // Building route for exposed quests

  const goblinAPI = quest.getAPI(goblinId);

  const {log} = quest;

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
        tags: [goblinId],
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

      const handleRequest = watt(function* (request) {
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
                request.body = yield parseJsonFromStream(request.body);
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
            response = yield goblinAPI[questName](questParams);

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
      });
      fastify.route({
        method: verb,
        url,
        schema,
        handler: watt(function* (request, reply, next) {
          let {code, payload, headers = null} = yield handleRequest(request);
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
            payload = yield encryptStream(payload, info.encryptionKey, next);
          }
          reply.send(payload);
        }),
        ...additionRouteArgs,
      });
    });
});

Goblin.registerQuest(goblinName, 'remove-goblin-api', function* (
  quest,
  goblinId
) {
  // Need close/start or restart
  yield quest.me.deleteState({path: `trading.${goblinId}`});
});

Goblin.registerQuest(goblinName, 'remove-all-goblin-api', function* (quest) {
  // Need close/start  or restart
  yield quest.me.change({path: 'trading', newValue: {}});
});

Goblin.registerQuest(goblinName, 'start', async function (quest, next) {
  let currentAddress = quest.goblin.getX('address');

  if (currentAddress) {
    quest.log.info(
      `Fastify server already started on address: ${currentAddress} !`
    );
    return currentAddress;
  }

  const state = quest.goblin.getState();

  let goblinCount = state.get('trading').size;

  if (goblinCount === 0) {
    throw Error("Fastify server can't start without at least one goblin API !");
  }

  const fastify = quest.goblin.getX('fastify');

  // Parse content text/plain
  //fastify.addContentTypeParser('text/plain', {parseAs: 'string'}, function (
  //  req,
  //  body,
  //  done
  //) {
  //  // We can parse directly string content to JSON here (and decrypt if necessary ?)
  //  done(null, body);
  //});

  // Set keep alive timeout to 120 secondes
  fastify.server.keepAliveTimeout = 120000;

  // Start fastify server after you regitered goblin API
  await fastify.ready();
  fastify.swagger();
  const host = quest.goblin.getX('host');
  const port = quest.goblin.getX('port');
  try {
    currentAddress = await fastify.listen(port, host, next);
    quest.log.info(`Fastify server started on address: ${currentAddress}`);
  } catch (err) {
    throw new Error(`Error when starting fastify server : ${err}`);
  }

  quest.goblin.setX('address', currentAddress);

  // Return string to format : http://${host}:${port}
  return currentAddress;
});

Goblin.registerQuest(goblinName, 'restart', function* (quest) {
  // Close current instance
  yield quest.me.close();
  const state = quest.goblin.getState();
  const goblinIds = state.get('trading').keys();
  for (let id of goblinIds) {
    const config = state.get(`trading.${id}`).toJS();
    yield quest.me.addGoblinApi({goblinId: id, ...config});
  }
  const currentAddress = yield quest.me.start();
  return currentAddress;
});

Goblin.registerQuest(goblinName, 'close', function* (quest, init = true, next) {
  let currentAddress = quest.goblin.getX('address');
  if (currentAddress) {
    const fastify = quest.goblin.getX('fastify');
    quest.goblin.setX('address', null);
    quest.log.info(`Fastify server "${currentAddress}" closing...`);
    yield fastify.close(next);
    // Init again fastify instance
    if (init) {
      yield quest.me.restart();
    }
  }
});

Goblin.registerQuest(goblinName, 'delete', function* (quest) {
  // FIXME: should be sync only
  yield quest.me.close({init: false});
});

module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
