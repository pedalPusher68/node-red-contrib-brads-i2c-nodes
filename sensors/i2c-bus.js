/**
 * Created by brad on 4/6/17.
 */

module.exports = function(RED) {

  // Node.js Imports
  const exec = require('child_process').exec;
  const os = require('os');
  // NPM Imports
  const i2c = require('i2c-bus');

  const i2cBuses = [];

  function i2cBus(config) {

    RED.nodes.createNode(this,config);
    this.dev = config.dev;
    this.log('i2cBus:  config -> '+JSON.stringify( config ));

    exec('i2cdetect -l', (error, stdout, stderr) => {
      if (error) {
        this.error( `i2cdetect -l error:  ${error}`);
      } else {
        for (bus of stdout.split(os.EOL)) {
          let cols = bus.split('\t');
          if (cols && cols.length > 0) {
            i2cBuses.add(  '/dev/' + cols[0] );
          }
        }
        this.log('i2c-bus:  i2cBuses -> '+i2cBuses);
      }
    });

  }

  RED.nodes.registerType('i2cbus',i2cBus);

}