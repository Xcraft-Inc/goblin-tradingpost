const devMode = process.env.NODE_ENV === 'development';

const path = require('path');
const watt = require('watt');
const fastify = require('fastify')({
  logger: devMode ? true : false,
});

// Create swagger documentation if not in production
if (devMode) {
  fastify.register(require('fastify-swagger'), {
    swagger: {
      info: {
        title: 'Test of swagger with goblin-tradingpost',
        description: `Testing the fastify swagger api, isn't that pretty swag ?`,
        version: '0.0.1',
      },
    },
    exposeRoute: true,
    routePrefix: '/documentations',
  });
}

const goblinName = path.basename(module.parent.filename, '.js');
const Goblin = require('xcraft-core-goblin');

// Define initial logic values
const logicState = {
  id: goblinName,
};

// Define logic handlers according rc.json
const logicHandlers = {
  create: (state, action) => {
    return state.set('id', action.get('id'));
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

Goblin.registerQuest(goblinName, 'create', function (quest) {
  quest.do();
});

Goblin.registerQuest(goblinName, 'start', function* (
  quest,
  goblinId,
  questsBlacklist = [], // Come from xcraft config later ?
  secure = null, // Use crypted key given as spawn args, path to key ?
  next
) {
  let currentAddress = quest.goblin.getX('address');

  if (currentAddress) {
    return currentAddress;
  }

  // Content text/plain
  fastify.addContentTypeParser('text/plain', {parseAs: 'string'}, function (
    req,
    body,
    done
  ) {
    // We can parse directly string content to JSON here (and decrypt if necessary ?)
    done(null, body);
  });

  // Default route for basic test

  fastify.get(
    '/',
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

  // Building route for exposed quests

  const goblinAPI = quest.getAPI(goblinId);

  const goblinIdName = goblinId.split('@')[0];

  publicMethods(goblinAPI)
    .filter((item) => !questsBlacklist.includes(item))
    .forEach((name) => {
      // reset default values
      quest.log.dbg(`register quest '${name}' to HTTP server`);
      const registryQuestName = transformQuestName(name);
      const cmdRegistry = quest.resp.getCommandsRegistry();
      const currentCmd = cmdRegistry[`${goblinIdName}.${registryQuestName}`];
      let params = {required: [], optional: []};
      if (currentCmd) {
        params = currentCmd.options.params;
      }
      fastify.put(
        `/${name}`,
        {
          schema: {
            description: `PUT route with args required (${params.required.toString()}) and optional (${params.optional.toString()})`,
            tags: ['Exposed quests'],
            body: {},
          },
        },
        watt(function* (request, reply, next) {
          try {
            // TODO : Handle secure option to crypt/decrypt data
            quest.log.dbg(`Route "/${name}" with args: ` + request.body);
            if (typeof request.body === 'string')
              request.body = JSON.parse(request.body);
            let response = yield goblinAPI[name](request.body);
            // crypt response and change http-headers ?
            // if(secure) {}
            return response;
          } catch (e) {
            reply.code(400);
            // Crypt also body response even if it's empty
            return '';
          }
        })
      );
    });

  // Start of fastify server

  const startServer = watt(function* (next) {
    try {
      return yield fastify.listen(next);
    } catch (err) {
      //fastify.log.error(err);
      quest.log.err(`Error when starting fastify server : ${err}`);
    }
  });

  currentAddress = yield startServer();

  quest.goblin.setX('address', currentAddress);

  // Return string to this format : http://${host}:${port}
  return currentAddress;
});

Goblin.registerQuest(goblinName, 'close', function* (quest, next) {
  yield fastify.close(next);
});

module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
