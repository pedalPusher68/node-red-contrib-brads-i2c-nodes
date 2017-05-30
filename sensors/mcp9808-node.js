/**
 * Created by brad on 3/27/17.
 */

module.exports = function (RED) {

  "use strict";
  // NPM Imports
  const i2c = require('i2c-bus');
  // Local Imports
  // const Measurement = require('./Measurement.js');

  //                  AAA
  //                  210
  //                  === (A2, A1, A0 bits)
  const MCP9808Address000 = 0x18;
  const MCP9808Address001 = 0x19;
  const MCP9808Address010 = 0x1a;
  const MCP9808Address011 = 0x1b;
  const MCP9808Address100 = 0x1c;
  const MCP9808Address101 = 0x1d;
  const MCP9808Address110 = 0x1e;
  const MCP9808Address111 = 0x1f;

  // TODO connect these register constants to appropriate Node RED inputs HTML for this node...
  const REGISTER_CONFIGURATION = 0x01;
  const REGISTER_ALERT_TEMP_UPPER_BOUNDARY = 0x02;
  const REGISTER_ALERT_TEMP_LOWER_BOUNDARY = 0x03;
  const REGISTER_CRITICAL_TEMP_TRIP = 0x04;
  const REGISTER_TEMPERATURE = 0x05;
  const REGISTER_MANUFACTURER_ID = 0x06;
  const REGISTER_DEVICE_ID = 0x07;
  const REGISTER_RESOLUTION = 0x08;

  const RESOLUTIONS = new Map();
  RESOLUTIONS.set('0', {
    display: '+/- 0.5 \u2103',
    displayF: '+/- 0.9 \u2109',
    timeMs: 30,
    value: 0.5,
    decimalPlaces: 1,
    commandByte: 0
  });
  RESOLUTIONS.set('1', {
    display: '+/- 0.25 \u2103',
    displayF: '+/- 0.45 \u2109',
    timeMs: 65,
    value: 0.25,
    decimalPlaces: 2,
    commandByte: 1
  });
  RESOLUTIONS.set('2', {
    display: '+/- 0.125 \u2103',
    displayF: '+/- 0.225 \u2109',
    timeMs: 130,
    value: 0.125,
    decimalPlaces: 3,
    commandByte: 2
  });
  RESOLUTIONS.set('3', {
    display: '+/- 0.0625 \u2103',
    displayF: '+/- 0.1125 \u2109',
    timeMs: 250,
    value: 0.0625,
    decimalPlaces: 4,
    commandByte: 3
  }); // default

  const dateFormatOptions = {
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false, timeZone: 'America/New_York'
  };

  let i2cBus = undefined;

  //         a2tjosmj04ve84.iot.us-east-1.amazonaws.com
  //zipw-001@a2tjosmj04ve84.iot.us-east-1.amazonaws.com

  function mcp9808(config) {

    RED.nodes.createNode(this, config);

    let BigNumber = require('bignumber.js');
    let node = this;

    // 1. process config - pull parameter values
    // 2. initialize sensor
    // 3. update node.status and begin measuring if wired to.

    // 1. Process Config
    node.debugMode = (config && config.debugMode);
    if (node.debugMode) {
      node.log(JSON.stringify(config));
    }
    node.name = (config && config.name) ? config.name : undefined;
    node.address = config.address;
    if (node.address < MCP9808Address000 || node.address > MCP9808Address111) {
      node.error(`${node.address} is a bad address - check config.`);
      node.status({fill: "red", shape: "ring", text: `${node.address} is a bad address - check config.`});
    }
    node.resolution = (config && config.resolution) ? RESOLUTIONS.get(config.resolution) : RESOLUTIONS.get('3');
    node.units = (config && config.units) ? config.units : 'F';

    if (node.debugMode) {
      node.log(`mcp9808 configuration`);
      node.log(`name -> ${node.name}`);
      node.log(`resolution -> ${JSON.stringify(node.resolution)}`);
      node.log(`address -> ${node.address}`);
      node.log(`units -> ${node.units}`);
      node.log(`debugMode -> ${node.debugMode}`);
    }

    this.on('deploy', (msg) => {
      node.log(`deploy event recieved msg -> ${msg}`);
    });

    // 2. Initialize Sensor
    node.ready = false;
    node.status({fill: "green", shape: "ring", text: "mcp9808 initializing"});

    if (i2cBus == undefined) {
      // I2C Bus has to be open for device to work so open it synchronously
      i2cBus = i2c.openSync(1);
      if (!i2cBus) {
        node.error(`problem initializing i2c bus 1.`);
        node.status({fill: "red", shape: "ring", text: `problem initializing i2c bus 1.`});
      }
    }

    let dp = (node.resolution) ? node.resolution.decimalPlaces : 4;
    BigNumber.config({DECIMAL_PLACES: dp});

    let ip1 = new Promise((resolve, reject) => {
      i2cBus.readWord(node.address, REGISTER_DEVICE_ID, (err, wordBytes) => {
        if (err) {
          let errMsg = `mcp9808 get device ID error:  ${err}`;
          node.status({fill: "red", shape: "ring", text: errMsg});
          reject(errMsg);
        } else {
          // node.deviceId = ((wordBytes & 0xff00) >> 8);
          // TODO - on 4/22/2017, the wordBytes seem to be reverse from what I've seen to this point...
          // TODO   - pull ManufacturerId for comparison - should be 0x0054
          node.deviceId = wordBytes;
          node.log(`wordBytes => 0x${wordBytes.toString(16)}, B${wordBytes.toString(2)},  deviceId -> ${node.deviceId}`);
          // if (node.deviceId != 0x04) {
          //   reject(`Bad deviceId (${node.deviceId}) at address 0x${node.address.toString(16)}.`);
          // }
          let resolveMsg = `Device ID:  0x${node.deviceId.toString(16)}`;
          if (node.debugMode) {
              node.log(resolveMsg);
          }
          resolve(resolveMsg);
        }
      });
    });

    let ip2 = new Promise((resolve, reject) => {
      i2cBus.writeByte(node.address, REGISTER_RESOLUTION, node.resolution.commandByte, (err) => {
        if (err) {
          let errMsg = `mcp9808 set resolution error:  ${err}`;
          node.status({fill: "red", shape: "ring", text: errMsg});
          reject(errMsg);
        } else {
          resolve(`mcp9808 resolution set`);
        }
      });
    });

    Promise.all([ip1, ip2]).then((resolve) => {
      // node.status({fill: "green", shape: "dot", text: "mcp9808 ready"});
      node.ready = true;
      node.emit('sensor_ready', resolve);
    }, (reject) => {
      node.status({fill: "red", shape: "ring", text: "mcp9808 check configuration"});
      node.error(`${reject}:  node.ready -> ${node.ready}:  , node.deviceId -> ${node.deviceId}`);
    });

    node.on('sensor_ready', (msg) => {
      if (node.debugMode) {
        node.log(`sensor_ready:  msg -> ${msg}`);
      }
      node.status({fill: "green", shape: "dot", text: "mcp9808 ready"});
    });

    this.on('input', (msg) => {

      if (node.ready) {
        let command = msg.payload; // One of:  measure, set_config, get_config, ... TODO - add other input types support
        if (command) {
          if ("measure" == command) {

            let mp1 = new Promise((resolve, reject) => {
              i2cBus.writeByte(node.address, REGISTER_TEMPERATURE, 0x01, (err) => {
                setTimeout( () => {
                  if (err) {
                    reject(`mcp9808 set measure temperature error:  ${err}`);
                  } else {

                    let buffer = new Uint8Array(2);
                    i2cBus.readI2cBlock(node.address, REGISTER_TEMPERATURE, buffer.length, buffer, (err, bytesRead, buffer) => {
                      if (err) {
                        reject( `mcp9808 get temperature bytes error:  ${err}` );
                      } else {
                        let upperByte = buffer[0] & 0x1f; // ignore other flags
                        let lowerByte = buffer[1];
                        let posNeg = (upperByte & 0x10) ? -1 : 1;
                        let temperature = new BigNumber(lowerByte).div(16).plus(upperByte * 16);
                        if (posNeg == -1) {
                          upperByte = upperByte & 0x0f;
                          temperature = temperature.neg().plus(256);
                        }
                        let temperatureF = temperature.times(1.8).plus(32.0);
                        let measurementDate = new Date().toLocaleString('en-US', dateFormatOptions);

                        node.log("temperatureF -> "+temperatureF);
                        resolve({
                          temperature: temperature,
                          temperatureF: temperatureF,
                          timestamp: measurementDate
                        });
                      }
                    });
                  }
                }, node.resolution.timeMs);
              });
            }).then( (resolve) => {
              node.log( JSON.stringify( resolve ));
              let payload1 = {
                device: "sensor",
                name: "mcp9808",
                temperatureF: resolve.temperatureF,
                temperatureC: resolve.temperature,
                resolution: node.resolution.display,
                timestamp: resolve.timestamp
              };

              let thingShadow = {
                state: {
                  "reported": {
                    "device": "sensor",
                    "name": "mcp9808",
                    "temperature": resolve.temperatureF,
                    "temperatureUnits": "degrees Fahrenheit",
                    "deviceResolution": node.resolution.displayF,
                    "timestamp": resolve.timestamp
                  }
                }
              };

              node.send([
                {topic: 'mcp9808', payload: payload1},
                {topic: 'mcp9808', payload: thingShadow}
              ]);

              }, (reject) => {
                node.status({fill: "red", shape: "dot", text: reject});
                node.error( reject );
              }
            );

          } else if ("some_other_tbd_command" == command) {
            // TODO - set mcp9808 configuration
          } else {

          }
        }
      }
    });

  }

  RED.nodes.registerType("mcp9808", mcp9808);

  // TODO - see https://nodered.org/docs/creating-nodes/status to set status while node is running...

}

