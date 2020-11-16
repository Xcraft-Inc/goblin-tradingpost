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

Goblin.registerQuest(goblinName, 'create', function* (quest) {
  quest.do();
  // Init fastify instance on creation
  yield quest.me.initialization();
});

Goblin.registerQuest(goblinName, 'change', function (quest) {
  quest.do();
});

Goblin.registerQuest(goblinName, 'delete-state', function (quest) {
  quest.do();
});

Goblin.registerQuest(goblinName, 'initialization', function (quest) {
  const fastify = require('fastify')({
    logger: devMode ? true : false,
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

  // Create swagger docs if dev env.
  if (devMode) {
    fastify.register(require('fastify-swagger'), {
      swagger: {
        info: {
          title: 'Swagger of goblin-tradingpost',
          description: `Fastify swagger api, isn't that pretty swag ?`,
          version: '0.0.1',
        },
        consumes: ['text/plain', 'application/json'],
        produces: ['application/json', 'text/plain'],
      },

      exposeRoute: true,
      routePrefix: '/docs',
    });
  }
  quest.goblin.setX('fastify', fastify);
});

Goblin.registerQuest(goblinName, 'add-goblin-api', function* (
  quest,
  goblinId,
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

  const goblinIdName = goblinId.split('@')[0];

  // Default route who return goblinId

  fastify.get(
    `/${goblinId}`,
    {
      schema: {
        description: 'GET route',
        tags: ['Test route'],
        summary: 'get current goblinId exposed',
      },
    },
    async (request, reply) => {
      return goblinId;
    }
  );

  // Building route for exposed quests

  const goblinAPI = quest.getAPI(goblinId);

  const {log} = quest;

  const allowedCommandsName = Object.keys(allowedCommands);
  publicMethods(goblinAPI)
    .filter((item) => allowedCommandsName.includes(item))
    .forEach((questName) => {
      // reset default values
      log.dbg(`register quest '${goblinId}/${questName}' to HTTP server`);
      // transform quest name ex. 'add-quest' => 'addQuest'
      const registryQuestName = transformQuestName(questName);
      const cmdRegistry = quest.resp.getCommandsRegistry();
      const currentCmd = cmdRegistry[`${goblinIdName}.${registryQuestName}`];
      let params = {required: [], optional: []};
      if (currentCmd) {
        params = currentCmd.options.params;
      }

      let verb = allowedCommands[questName].verb || 'PUT';
      verb = verb.toUpperCase();

      let additionRouteArgs = {};
      if (verb !== 'GET') {
        additionRouteArgs = additionRouteArgs.body = {};
      }

      fastify.route({
        method: verb,
        url: `/${goblinId}/${questName}`,
        schema: {
          description: allowedCommands[questName].description || '',
          tags: [goblinId],
        },
        handler: watt(function* (request, reply) {
          try {
            // TODO : Handle secure option to crypt/decrypt data

            if (typeof request.body === 'string') {
              // empty string converted to '{}'
              request.body = JSON.parse(request.body || '{}');
            }
            log.dbg(
              `Route "/${goblinIdName}/${questName}" with args: ${JSON.stringify(
                request.body
              )}`
            );
            let response = yield goblinAPI[questName](request.body);
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

Goblin.registerQuest(goblinName, 'start', function* (quest, host, port, next) {
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

  // Default ping test route
  fastify.get(
    '/ping',
    {
      schema: {
        description: 'GET route',
        tags: ['Test route'],
        summary: 'ping pong',
      },
    },
    async (request, reply) => {
      return 'pong';
    }
  );

  // Start fastify server after you regitered goblin API
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
