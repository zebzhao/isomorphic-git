module.exports = function (api) {
  api.cache(true)

  const presets = [
    ['@babel/preset-env', {
      useBuiltIns: 'usage',
      targets: 'chrome 55, ios_saf 12'
    }]
  ]
  const plugins = []

  return {
    presets,
    plugins,
    sourceType: 'unambiguous'
  }
}
