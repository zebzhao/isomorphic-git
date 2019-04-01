module.exports = function (api) {
  api.cache(true)

  const presets = [
    ['@babel/preset-env', {
      'useBuiltIns': 'usage',
      'targets': 'chrome 51, ios_saf 11.4'
    }]
  ]
  const plugins = []

  return {
    presets,
    plugins,
    sourceType: 'unambiguous'
  }
}
