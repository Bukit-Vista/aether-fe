/* eslint-disable no-unused-vars */
const file_bar = require('./ui/file_bar'),
  dnd = require('./ui/dnd'),
  layer_switch = require('./ui/layer_switch'),
  projection_switch = require('./ui/projection_switch');

module.exports = ui;

function ui(context) {
  function init(selection) {
    const container = selection
      .append('div')
      .attr(
        'class',
        'ui-container grow flex-shrink-0 flex flex-col md:flex-row w-full relative overflow-x-hidden'
      );

    const map = container
      .append('div')
      .attr('id', 'map')
      .attr('class', 'map grow shrink-0 top-0 bottom-0 left-0 basis-full')
      .call(layer_switch(context))
      .call(projection_switch(context));

    context.container = container;

    return container;
  }

  function render(selection) {
    const container = init(selection);

    container
      .append('div')
      .attr('class', 'file-bar hidden md:block')
      .call(file_bar(context));

    dnd(context);

    // initialize the map after the ui has been created to avoid flex container size issues
    context.map();
  }

  return {
    read: init,
    write: render
  };
}
