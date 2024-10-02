const {Elf} = require('xcraft-core-goblin');
const {Tradingpost, TradingpostLogic} = require('./lib/service.js');

exports.xcraftCommands = Elf.birth(Tradingpost, TradingpostLogic);
