const ui = require('./ui'),
  map = require('./ui/map'),
  data = require('./core/data'),
  loader = require('./core/loader'),
  router = require('./core/router'),
  store = require('store');

const gjIO = geojsonIO(),
  gjUI = ui(gjIO).read;

d3.select('.geojsonio').call(gjUI);

gjIO.router.on();

function geojsonIO() {
  const context = {};
  context.dispatch = d3.dispatch('change', 'route');
  context.storage = store;
  context.map = map(context, true);
  context.data = data(context);
  context.dispatch.on('route', loader(context));
  context.router = router(context);
  return context;
}
