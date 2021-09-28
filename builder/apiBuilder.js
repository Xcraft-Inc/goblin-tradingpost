'use strict';
7;

const Goblin = require('xcraft-core-goblin');
const common = require('goblin-workshop').common;

module.exports = (config) => {
  const {
    name,
    host,
    port,
    apiKey,
    exposeSwagger,
    swaggerServerUrl,
    schemaBuilder,
    quests,
    options,
    skills,
  } = config;
  const goblinName = `${name}-api`;

  // Define logic handlers according rc.json
  const logicHandlers = {
    create: (state, action) => {
      return state.set('', {
        id: action.get('id'),
      });
    },
  };

  Goblin.registerQuest(
    goblinName,
    'create',
    function* (quest, desktopId) {
      quest.goblin.setX('desktopId', desktopId);
      const tradeAPI = yield quest.create('tradingpost', {
        id: `tradingpost@${quest.goblin.id}`,
        desktopId,
        host,
        port,
        exposeSwagger,
        swaggerServerUrl,
      });

      const buildParam = (allParams) => (...params) => {
        return params.reduce(
          (p, n) => {
            p.properties[n] = allParams[n];
            return p;
          },
          {
            type: 'object',
            required: params,
            properties: {},
          }
        );
      };
      const commands = schemaBuilder(buildParam);
      yield tradeAPI.addGoblinApi({
        goblinId: quest.goblin.id,
        apiKey,
        allowedCommands: commands,
      });

      const url = yield tradeAPI.start();
      quest.do();
      console.log(
        '\x1b[32m%s\x1b[0m',
        `API BUILDER: ${quest.goblin.id} API ${url} [RUNNING]`
      );
      console.log(`open ${url}/docs/index.html`);
      return quest.goblin.id;
    },
    {skills: skills ?? []}
  );

  if (quests) {
    common.registerQuests(goblinName, quests, options);
  }

  function disposeQuest(quest) {
    if (quest.goblin.getX('isDisposing')) {
      return;
    }

    quest.goblin.setX('isDisposing', true);
  }

  Goblin.registerQuest(goblinName, 'dispose', disposeQuest);

  Goblin.registerQuest(goblinName, 'delete', function (quest) {
    disposeQuest(quest);
  });

  return Goblin.configure(goblinName, {}, logicHandlers);
};
