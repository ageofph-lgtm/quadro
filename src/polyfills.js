// Polyfills que o build legacy do pdf.js não cobre (navegadores de celular de antes de 2024).
// Carregado antes do pdf.js, na página e no worker.
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new this((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}
if (typeof Promise.try !== 'function') {
  Promise.try = function (fn, ...args) { return new this((res) => res(fn(...args))); };
}
if (typeof Array.prototype.at !== 'function') {
  Object.defineProperty(Array.prototype, 'at', { configurable: true, writable: true, value(i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this[i]; } });
}
if (typeof structuredClone !== 'function') {
  globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
}
