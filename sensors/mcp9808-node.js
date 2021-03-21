/**
 * Created by brad on 3/27/17.
 */

module.exports = function (RED) {

  "use strict";
  // NPM Imports
  const i2c = require('i2c-bus');
  // Local Imports
  const Util = require('./util.js');

  // MCP9808 Device Constants
  // - possible I2C addresses
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

  // - device registers
  const REGISTER_CONFIGURATION = 0x01;
  const REGISTER_ALERT_TEMP_UPPER_BOUNDARY = 0x02;
  const REGISTER_ALERT_TEMP_LOWER_BOUNDARY = 0x03;
  const REGISTER_CRITICAL_TEMP_TRIP = 0x04;
  const REGISTER_TEMPERATURE = 0x05;
  const REGISTER_MANUFACTURER_ID = 0x06;
  const REGISTER_DEVICE_ID = 0x07;
  const REGISTER_RESOLUTION = 0x08;

  // - device settings
  //   - measurement resolutions
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

  let i2cBus = undefined;

  function mcp9808(config) {

    RED.nodes.createNode(this, config);

    let BigNumber = require('bignumber.js');
    let node = this;

    // 1. process config - pull parameter values
    // 2. initialize sensor
    // 3. update node.status and begin measuring if wired to.

    // 1. Process Config
    deviceConfig(node, config)

    node.debugMode = (config && config.debugMode);

    function debug(msg) {
      if (node.debugMode) {
        node.log(msg);
        node.debug(msg);
      }
    }

    debug(JSON.stringify(config));

    node.address = config.address;
    if (node.address < MCP9808Address000 || node.address > MCP9808Address111) {
      node.error(`${node.address} is a bad address - check config.`);
      node.status({fill: "red", shape: "ring", text: `${node.address} is a bad address - check config.`});
    }
    node.name = `MCP9808 @ 0x${node.address.toString(16)}`;
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
      const buffer = Buffer.alloc(2)

      i2cBus.readI2cBlock(node.address, REGISTER_DEVICE_ID, 2, buffer, (err, bytesRead, buffer) => {
        if (err) {
          let errMsg = `mcp9808 get device ID error:  ${err}`;
          node.status({fill: "red", shape: "ring", text: errMsg});
          reject(errMsg);
        } else {
          node.deviceId = buffer.readInt8(0);
          node.deviceRevision = buffer.readInt8(1);
          if (node.deviceId === 0x04) {
            resolve(`Device ID:  0x${node.deviceId.toString(16)}`);
          } else {
            reject(`MCP9808(@ 0x${node.address.toString(16)}) read Device ID:  0x${node.deviceId.toString(16)} - expected 0x04`)
          }
        }
      })
    })

    let ip2 = new Promise((resolve, reject) => {
      const buffer = Buffer.alloc(2)

      i2cBus.readI2cBlock(node.address, REGISTER_MANUFACTURER_ID, 2, buffer, (err, bytesRead, buffer) => {
        if (err) {
          let errMsg = `mcp9808 get device manufacturer ID error:  ${err}`;
          node.status({fill: "red", shape: "ring", text: errMsg});
          reject(errMsg);
        } else {
          node.manufacturerId = buffer.readInt16BE(0);
          if (node.manufacturerId === 0x0054) {
            debug(`Manufacturer ID:  0x${node.manufacturerId.toString(16)}`);
            resolve(`Manufacturer ID:  0x${node.manufacturerId.toString(16)}`);
          } else {
            reject(`MCP9808(@ 0x${node.address.toString(16)}) read Manufacturer ID:  0x${node.manufacturerId.toString(16)} - expected 0x0054`)
          }
        }
      })
    })

    // Apply Configuration to Device
    let ip3 = new Promise((resolve, reject) => {
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

    Promise.all([ip1, ip2, ip3]).then((resolve) => {
      // node.status({fill: "green", shape: "dot", text: "mcp9808 ready"});
      node.ready = true;
      node.emit('sensor_ready', resolve);
    }, (reject) => {
      node.status({fill: "red", shape: "ring", text: "mcp9808 check configuration"});
      node.error(`${reject}:  node.ready -> ${node.ready}:  , node.deviceId -> ${node.deviceId}`);
    });

    node.on('sensor_ready', (msg) => {
      debug(`sensor_ready:  msg -> ${msg}`);
      node.status({fill: "green", shape: "dot", text: "mcp9808 ready"});
    });

    this.on('input', (msg) => {

      if (node.ready) {
        let command = msg.payload; // One of:  measure, set_config, get_config, ... TODO - add other input types support
        if (command) {
          if ("measure" === command) {

            let mp1 = new Promise((resolve, reject) => {
              i2cBus.writeByte(node.address, REGISTER_TEMPERATURE, 0x01, (err) => {
                setTimeout( () => {
                  if (err) {
                    reject(`mcp9808 set measure temperature error:  ${err}`);
                  } else {

                    let buffer = Buffer.alloc(2)
                    i2cBus.readI2cBlock(node.address, REGISTER_TEMPERATURE, buffer.length, buffer, (err, bytesRead, buffer) => {
                      if (err) {
                        reject( `mcp9808 get temperature bytes error:  ${err}` );
                      } else {
                        let upperByte = buffer[0] & 0x1f; // ignore other flags
                        let lowerByte = buffer[1];
                        let posNeg = (upperByte & 0x10) ? -1 : 1;
                        let temperature = new BigNumber(lowerByte).div(16).plus(upperByte * 16);
                        if (posNeg === -1) {
                          upperByte = upperByte & 0x0f;
                          temperature = temperature.neg().plus(256);
                        }
                        let temperatureF = temperature.times(1.8).plus(32.0);
                        let timestamp = Util.getTimestamp()

                        debug("temperatureF -> " + temperatureF);
                        resolve(
                          {
                            'name': node.name,
                            'timestamp': timestamp,
                            'Tc': Util.roundValue(temperature),
                            'Tf': Util.roundValue(temperatureF)
                          }
                        );
                      }
                    });
                  }
                }, node.resolution.timeMs);
              });
            }).then( (resolve) => {
              debug(JSON.stringify(resolve));
              //{ 'name': node.name, 'timestamp': timestamp, 'Tc':Util.roundValue( temperature ), 'Tf':Util.roundValue(temperatureF) }

              let thingShadow = {
                state: {
                  "reported": {
                    "device": "sensor",
                    "name": "mcp9808",
                    "temperature": resolve.Tf,
                    "temperatureUnits": "degrees Fahrenheit",
                    "deviceResolution": node.resolution.displayF,
                    "timestamp": resolve.timestamp
                  }
                }
              };

              node.send([
                {topic: 'mcp9808', payload: resolve},
                {topic: 'mcp9808', payload: thingShadow}
              ]);

              }, (reject) => {
                node.status({fill: "red", shape: "dot", text: reject});
                node.error( reject );
              }
            );

          } else if ("some_other_tbd_command" == command) {
            // TODO - respond to another command
          } else {
            // no op
          }
        }
      }
    });

    function deviceConfig(node, config) {
      debug(`deviceConfig:  node -> ${node.name},  config -> ${JSON.stringify(config)}`)
    }

  }

  RED.nodes.registerType("mcp9808", mcp9808);

}

