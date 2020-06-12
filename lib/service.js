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

// Not working for the moment
//const STRIP_COMMENTS = /(\/\/.*$)|(\/\*[\s\S]*?\*\/)|(\s*=[^,\)]*(('(?:\\'|[^'\r\n])*')|("(?:\\"|[^"\r\n])*"))|(\s*=[^,\)]*))/gm;
//const ARGUMENT_NAMES = /([^\s,]+)/g;
//
//function paramNames(func) {
//  const fnStr = func.toString().replace(STRIP_COMMENTS, '');
//  const result = fnStr
//    .slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')'))
//    .match(ARGUMENT_NAMES);
//  return result || [];
//}

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

  // Default route for basic test

  fastify.get(
    '/',
    {
      schema: {
        description: 'GET route',
        tags: ['Test route'],
        summary: 'toutouyoutou',
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
        summary: 'toutouyoutou',
      },
    },
    async (request, reply) => {
      return 'pong';
    }
  );

  // Building route for exposed quests

  const goblinAPI = quest.getAPI(goblinId);

  publicMethods(goblinAPI)
    .filter((item) => !questsBlacklist.includes(item))
    .forEach((name) => {
      quest.log.dbg(`register quest '${name}' to HTTP server`);
      // TODO : Fix discover of arguments, no more working for the moment
      // const model = paramNames(goblinAPI[name]);
      // quest.log.dbg(`Model: ${JSON.stringify(model)}`);
      fastify.put(
        `/${name}`,
        {
          schema: {
            description: 'PUT route',
            tags: ['Exposed quests'],
            summary: 'toutouyoutou',
            params: {
              type: 'object',
              properties: {
                describe: {
                  your: 'string',
                  params: 'user id',
                  here: 'integer',
                },
              },
            },
            body: {
              type: 'object',
              properties: {
                hello: {type: 'string'},
                world: {
                  my: 'object',
                  name: {
                    is: {type: 'string'},
                    eminem: {type: 'string'},
                  },
                },
              },
            },
            response: {
              200: {
                description: 'Successful response',
                type: 'object',
                properties: {
                  hello: {type: 'string'},
                },
              },
            },
            security: [
              {
                apiKey: [],
              },
            ],
          },
        },
        watt(function* (request, reply, next) {
          try {
            // TODO : Handle secure option to crypt/decrypt data
            quest.log.dbg(
              `Route "/${name}" with args: ` + JSON.stringify(request.body)
            );
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
      quest.log.error(`Error when starting fastify server : ${err}`);
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
