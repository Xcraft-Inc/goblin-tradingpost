const devMode = process.env.NODE_ENV === 'development';

const path = require('path');
const watt = require('watt');

const goblinName = path.basename(module.parent.filename, '.js');
const Goblin = require('xcraft-core-goblin');

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

// Keep only functions of goblin exposed
function publicMethods(obj) {
  return Object.getOwnPropertyNames(obj).filter(
    (property) => typeof obj[property] === 'function'
  );
}

function transformQuestName(name) {
  let newName = '';
  for (let i = 0; i < name.length; i++) {
    if (name[i] === name[i].toUpperCase()) {
      newName += `-${name[i].toLowerCase()}`;
    } else {
      newName += name[i];
    }
  }
  return newName;
}

Goblin.registerQuest(goblinName, 'change', function (quest) {
  quest.do();
});

Goblin.registerQuest(goblinName, 'delete-state', function (quest) {
  quest.do();
});

Goblin.registerQuest(goblinName, 'create', function (
  quest,
  host = '127.0.0.1',
  port = 8080
) {
  quest.goblin.setX('host', host);
  quest.goblin.setX('port', port);

  quest.do();
  const fastify = require('fastify')({
    logger: devMode ? true : false,
  });

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
  fastify.register(
    fp(formPlugin, {
      fastify: '^3.0.0',
      name: 'fastify-formbody',
    }),
    {}
  );

  const oas = require('fastify-oas');
  fastify.register(oas, {
    swagger: {
      info: {
        title: 'Goblin Trading Post',
        description: '',
        version: '1.0.0',
      },
      host: `http://${host}:${port}`,
      servers: [
        {
          url: `http://${host}:${port}/`,
          description: devMode ? `dev server` : 'release server',
        },
      ],

      schemes: ['http', 'https'],
      consumes: ['text/plain', 'application/json'],
      produces: ['application/json', 'text/plain'],
      securityDefinitions: {
        apiKey: {
          type: 'apiKey',
          name: 'apiKey',
          in: 'header',
        },
      },
    },
    exposeRoute: devMode,
    routePrefix: '/docs',
  });

  quest.goblin.setX('fastify', fastify);
});

Goblin.registerQuest(goblinName, 'add-goblin-api', function* (
  quest,
  goblinId,
  apiKey = [],
  apiVersion = '1',
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

  yield quest.me.change({
    path: `trading.${goblinId}`,
    newValue: {allowedCommands, secure},
  });

  const goblinIdName = goblinId.split('@', 1)[0];

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
      const response = {};

      if (apiKey.length > 0) {
        response[401] = {
          type: 'string',
          description: 'API key is missing or invalid',
        };
      }

      if (params && body) {
        throw new Error(
          `Cannot register ${questName}, mixing body and params is not allowed`
        );
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
        response,
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

      fastify.route({
        prefix: `/v${apiVersion}`,
        method: verb,
        url: `/${route}`,
        schema,
        handler: watt(function* (request, reply) {
          try {
            // TODO : Handle secure option to crypt/decrypt data
            let response;

            if (apiKey.length > 0 && !request.headers.apikey) {
              reply.code(401);
              return 'API key is missing or invalid';
            }

            if (apiKey.length > 0) {
              const key = request.headers.apikey;
              if (!apiKey.includes(key)) {
                reply.code(401);
                return 'API key is missing or invalid';
              }
            }

            let questParams;

            if (queryString) {
              questParams = {...request.query};
            }

            if (body) {
              questParams = {...questParams, ...request.body};
            }

            if (params) {
              questParams = {...questParams, ...request.params};
            }

            response = yield goblinAPI[questName](questParams);

            // crypt response and change http-headers ?
            // if(secure) {}
            if (response === undefined) {
              return '';
            }
            if (!allowedCommands[questName].contentType) {
              allowedCommands[questName].contentType = 'application/json';
            }
            const contentType = [];

            contentType.push(allowedCommands[questName].contentType);
            contentType.push('charset=utf-8');

            return reply
              .code(200)
              .header('Content-Type', contentType.join(';'))
              .send(response);
          } catch (e) {
            reply.code(400);
            // Crypt also body response even if it's empty
            return '';
          }
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

Goblin.registerQuest(goblinName, 'start', function* (quest, next) {
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
  const host = quest.goblin.getX('host');
  const port = quest.goblin.getX('port');
  try {
    currentAddress = yield fastify.listen(port, host, next);
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
      yield quest.me.initialization();
    }
  }
});

Goblin.registerQuest(goblinName, 'delete', function* (quest) {
  // FIXME: should be sync only
  yield quest.me.close({init: false});
});

module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
