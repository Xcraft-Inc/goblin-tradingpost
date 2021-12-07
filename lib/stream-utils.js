const { PassThrough, Transform } = require("stream");
const watt = require("watt");

class RewindableStream extends Transform {
  constructor() {
    super();
    this.accumulator = [];
  }

  getChunk(index) {
    return this.accumulator[index] || null;
  }

  setChunk(index, newChunk) {
    this.accumulator[index] = newChunk;
  }

  _transform(buf, enc, cb) {
    this.accumulator.push(buf);
    cb();
  }

  rewind() {
    var stream = new PassThrough();
    this.accumulator.forEach((chunk) => stream.write(chunk));
    return stream;
  }
}

const concatStreams = watt(function* (streams, next) {
  let pass = new PassThrough();
  let count = streams.length;
  for (let stream of streams) {
    pass = stream.pipe(pass, { end: false });
    yield stream.once("end", next);
  }
  return pass;
});

module.exports = { RewindableStream, concatStreams };
