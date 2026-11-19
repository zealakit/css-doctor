// Emulates css-loader's local-identifier output for tests.
module.exports = function fakeCssLoader(source) {
  const file = this.resourcePath.split("/").pop().replace(".module.css", "");
  const locals = {};
  for (const match of source.matchAll(/\.([\w-]+)/g)) {
    locals[match[1]] = `${file}_${match[1]}__h4sh`;
  }
  return `___CSS_LOADER_EXPORT___.locals = ${JSON.stringify(locals)};\nexport default ___CSS_LOADER_EXPORT___.locals;`;
};
