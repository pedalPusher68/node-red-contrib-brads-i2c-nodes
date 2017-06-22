/**
 * Copyright Bradley Smith, bradley.1.smith@gmail.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function (RED) {

  "use strict";
  const os = require('os');
  // NPM Imports
  const i2c = require('i2c-bus');
  // Local Imports
  const Util = require('./util.js');

  const TSL2561ddress000 = 0x29;
  const TSL2561ddress001 = 0x39; // default (floating)
  const TSL2561ddress002 = 0x49;

  // TODO connect these register constants to appropriate Node RED inputs HTML for this node...
  const REGISTER_CONTROL = 0x00;
  const REGISTER_TIMING = 0x01;
  const REGISTER_THRESHLOWLOW = 0x02;
  const REGISTER_THRESHLOWHIGH = 0x03;
  const REGISTER_THRESHHIGHLOW = 0x04;
  const REGISTER_THRESHHIGHHIGH = 0x05;
  const REGISTER_INTERRUPT = 0x06;
  const REGISTER_RSV1 = 0x07;
  const REGISTER_CRC = 0x08;
  const REGISTER_RSV2 = 0x09;
  const REGISTER_ID = 0x0A;
  const REGISTER_RSV3 = 0x0B;
  const REGISTER_DATA0LOW = 0x0C;
  const REGISTER_DATA0HIGH = 0x0D;
  const REGISTER_DATA1LOW = 0x0E;
  const REGISTER_DATA1HIGH = 0x0F;

  const CMD = 0b10000000;
  const CLEAR = 0b01000000; // write one to clear interrupt
  const WORD = 0b00100000; // indicates word is being written or read
  const BLOCK = 0b00010000; // indicates word is being written or read

  const POWER_UP = 0b00000011; // send this REGISTER_CONTROL to power up device
  const POWER_DOWN = 0b00000000; // send this REGISTER_CONTROL to power down device

  const GAIN_HIGH = 0b00010000; // High Gain:  16x
  const GAIN_LOW = 0b00000000; // Low Gain:    1x
  const GAIN_AUTO = 0b00000010; // Auto gain - made up value by me to try and guess the right gain and set it dynamically
  // Auto-gain thresholds
  const TSL2561_AGC_THI_13MS = 4850    // Max value at Ti 13ms = 5047
  const TSL2561_AGC_TLO_13MS = 100
  const TSL2561_AGC_THI_101MS = 36000   // Max value at Ti 101ms = 37177
  const TSL2561_AGC_TLO_101MS = 200
  const TSL2561_AGC_THI_402MS = 63000   // Max value at Ti 402ms = 65535
  const TSL2561_AGC_TLO_402MS = 500


  const INTEG = new Map();
  INTEG.set('0', {
    value: 0b00,
    timeMs: 14, // 13.7 ms
    scale: 0.034,
  });
  INTEG.set('1', {
    value: 0b01,
    timeMs: 101, // 101 ms
    scale: 0.252,
  });
  INTEG.set('2', {
    value: 0b10,
    timeMs: 402, // 402 ms
    scale: 1,
  });
  INTEG.set('3', {
    value: 0b11,
    timeMs: 0, // N/A
    scale: 0.0, // N/A
  });

  const DEVID = new Map();
  DEVID.set(0b00000000, 'TSL2560CS');
  DEVID.set(0b00010000, 'TSL2561CS');
  DEVID.set(0b01000000, 'TSL2560T/FN/CL');
  DEVID.set(0b01010000, 'TSL2561T/FN/CL');

  const dateFormatOptions = {
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false, timeZone: 'America/New_York'
  };

  let i2cBus = undefined;

  //         a2tjosmj04ve84.iot.us-east-1.amazonaws.com
  //zipw-001@a2tjosmj04ve84.iot.us-east-1.amazonaws.com

  function tsl2561(config) {

    RED.nodes.createNode(this, config);

    let BigNumber = require('bignumber.js');
    let node = this;

    // 1. process config - pull parameter values
    // 2. initialize sensor
    // 3. update node.status and begin measuring if wired to.

    // 1. Process Config
    node.debugMode = (config && config.debugMode);

    function debug(msg) {
      if (node.debugMode) {
        node.log(msg);
      }
    }

    debug(JSON.stringify(config));
    node.address = config.address;
    if (node.address < TSL2561ddress000 || node.address > TSL2561ddress002) {
      node.error(`${node.address} is a bad address - check config.`);
      node.status({fill: "red", shape: "ring", text: `${node.address} is a bad address - check config.`});
    }
    node.name = `TSL2561 @ 0x${node.address.toString(16)}`;
    node.integ = (config && config.integ) ? INTEG.get(config.integ) : INTEG.get('2');
    node.devid = undefined;
    node.revision = undefined;

    node.interruptSet = false;

    if (node.debugMode) {
      node.log(`tsl2561 configuration`);
      node.log(`==========================================`);
      node.log(`name -> ${node.name}`);
      node.log(`address -> ${node.address}`);
      node.log(`integ -> ${JSON.stringify(node.integ)}`);
      node.log(`debugMode -> ${node.debugMode}`);
      node.log(`------------------------------------------`);
    }

    this.on('deploy', (msg) => {
      debug(`deploy event recieved msg -> ${JSON.stringify(msg)}`);
    });

    // 2. Initialize Sensor
    node.ready = false;
    node.status({fill: "green", shape: "ring", text: "tsl2561 initializing"});

    if (i2cBus == undefined) {
      // I2C Bus has to be open for device to work so open it synchronously
      i2cBus = i2c.openSync(1);
      if (!i2cBus) {
        node.error(`problem initializing i2c bus 1.`);
        node.status({fill: "red", shape: "ring", text: `problem initializing i2c bus 1.`});
      }
    }

    node.decimalPlaces = (node.resolution) ? node.resolution.decimalPlaces : 4;

    let init = new Promise((resolve, reject) => {
      i2cBus.writeByte(node.address, CMD | REGISTER_CONTROL, POWER_UP, (err) => {
        if (err) {
          let errMsg = `${node.name} send POWER_UP CMD returned an error:  ${err}`;
          node.error(errMsg);
          node.status({fill: "red", shape: "ring", text: errMsg});
          reject(errMsg);
        } else {
          i2cBus.readByte(node.address, CMD | REGISTER_CONTROL, (err, byteRead) => {
            debug(`err -> ${err},  byteRead -> 0b${byteRead.toString(2)} (all bits)`);
            byteRead = byteRead & 0b00000011 // mask out bits 7-2;  they're reserved and can thus be anything.
            if (err || byteRead !== POWER_UP) {
              let errMsg = `tsl2561 POWER_UP error:  ${err}, byte read -> 0b${byteRead.toString(2)}`;
              node.status({fill: "red", shape: "ring", text: errMsg});
              reject(errMsg);
            } else {
              resolve(`tsl2561 POWER_UP succeeded`);
            }
          });
        }
      });
    });

    init.then((resolvedMsg) => {

      return new Promise((resolve, reject) => {
        i2cBus.readByte(node.address, CMD | REGISTER_ID, (err, byteRead) => {
          if (err) {
            let errMsg = `tsl2561 get device ID error:  ${err}`;
            node.status({fill: "red", shape: "ring", text: errMsg});
            reject(errMsg);
          } else {
            debug(`0b${byteRead.toString(2)}`);

            let d = DEVID.get(0xf0 & byteRead);
            if (d) {
              node.deviceId = d;
              node.revision = 0xf0 & byteRead;
              debug(`node.deviceId -> ${node.deviceId},  node.revision -> ${node.revision}`);
              resolve(`tsl2561 get device ID succeeded`);
            } else {
              let errMsg = `tsl2561 get device ID error:  unknown device ->  0x${d.toString(2)}`;
              node.status({fill: "red", shape: "ring", text: errMsg});
              reject(errMsg);
            }
          }
        });
      });
    }).then((resolvedMsg) => {

      return new Promise((resolve, reject) => {
        i2cBus.writeByte(node.address, CMD | REGISTER_TIMING, node.integ.value, (err) => {
          if (err) {
            let errMsg = `tsl2561 set timing error:  ${err},\t node.integ -> ${JSON.stringify(node.integ)}`;
            node.status({fill: "red", shape: "ring", text: errMsg});
            reject(errMsg);
          } else {
            resolve(`tsl2561 set timing succeeded`);
          }
        });
      });

    }).then((resolvedMsg) => {
      node.ready = true;
      node.emit('sensor_ready', resolvedMsg);
    }, (reject) => {
      node.status({fill: "red", shape: "ring", text: `tsl2561 check configuration:  ${reject}`});
      node.error(`${reject}:  node.ready -> ${node.ready}:  , node.deviceId -> ${node.deviceId}`);
    });

    node.on('sensor_ready', (msg) => {
      node.status({fill: "green", shape: "dot", text: `${node.deviceId} rev. ${node.revision} ready.`});
    });

    this.on('input', (msg) => {

      if (node.ready) {
        let command = msg.payload; // One of:  measure, set_config, get_config, ... TODO - add other input types support
        if (command) {
          if ("measure" == command) {

            let lux = 0;

            let buffer = new Uint8Array(4);
            let channel0 = 0;
            let channel1 = 0;

            let mp1 = new Promise((resolve, reject) => {
              debug(`CMD | REGISTER_TIMING | BLOCK -> 0b${(CMD | REGISTER_TIMING | BLOCK).toString(2)}`);
              debug(`GAIN_HIGH | node.integ.value -> 0b${(GAIN_HIGH | node.integ.value).toString(2)}`);
              i2cBus.writeByte(node.address, CMD | REGISTER_TIMING | BLOCK, GAIN_HIGH | node.integ.value, (err) => {
                if (err) {
                  let errMsg = `tsl2561 measure:  set timing error:  ${err},\t node.integ -> ${JSON.stringify(node.integ)}`;
                  node.status({fill: "red", shape: "ring", text: errMsg});
                  reject(errMsg);
                } else {
                  setTimeout(() => {
                    i2cBus.readI2cBlock(node.address, CMD | REGISTER_DATA0LOW, buffer.length, buffer, (err, bytesRead, buffer) => {
                      if (err) {
                        let errMsg = `tsl2561 measure:  get data error:  ${err}`;
                        node.status({fill: "red", shape: "ring", text: errMsg});
                        reject(errMsg);
                      } else {
                        channel0 = buffer[1] * 256 + buffer[0];
                        channel1 = buffer[3] * 256 + buffer[2];
                        if (node.debugMode) {
                          node.log(`Channel 0 (high, low):  0x${buffer[1].toString(16)}, 0x${buffer[0].toString(16)}\tvalue = 0x${channel0.toString(16)}`);
                          node.log(`Channel 1 (high, low):  0x${buffer[3].toString(16)}, 0x${buffer[2].toString(16)}\tvalue = 0x${channel1.toString(16)}`);

                          if (!node.interruptSet) {
                            let ch0TLow = channel0 * 0.7;
                            let ch0THigh = channel0 * 1.3;

                            i2cBus.writeWordSync(node.address, CMD | REGISTER_THRESHLOWLOW | WORD, 0xffff & ch0TLow);
                            i2cBus.writeWordSync(node.address, CMD | REGISTER_THRESHHIGHLOW | WORD, 0xffff & ch0THigh);
                            i2cBus.writeByteSync(node.address, CMD | REGISTER_INTERRUPT, 0b00010100);

                            node.interruptSet = true;
                          }
                        }

                        debug(`Approximate Lux:  ${lux}`);
                        lux = calculateLux(channel0, channel1, node.integ.value, GAIN_HIGH);
                        let timestamp = new Date().toLocaleString('en-US', dateFormatOptions);

                        resolve(
                          {
                            'name': node.name,
                            'timestamp': timestamp,
                            'lux': Util.roundValue(lux),
                            'ch0': channel0,
                            'ch1': channel1
                          }
                        );
                      }
                    });
                  }, node.integ.timeMs);
                }
              });
            }).then((resolve) => {
              debug(JSON.stringify(resolve));

                let thingShadow = {
                  state: {
                    "reported": {
                      "device": "sensor",
                      "name": "tsl2561",
                      "lux": resolve.lux,
                      "timestamp": resolve.timestamp
                    }
                  }
                };

                node.send([
                  {topic: 'tsl2561', payload: resolve},
                  {topic: 'tsl2561', payload: thingShadow}
                ]);

              }, (reject) => {
                node.status({fill: "red", shape: "dot", text: reject});
                node.error(reject);
              }
            );
          } else if ("clear_interrupt" == command) {
            // TODO - set tsl2561 configuration
            node.interruptSet = false;
            i2cBus.writeByteSync(node.address, CMD | CLEAR | REGISTER_INTERRUPT, 0b00000000);
          } else {
            // possibly something else.........
          }
        }
      }
    });
  }

  RED.nodes.registerType("tsl2561", tsl2561);

  const LUX_SCALE = 14;
  const RATIO_SCALE = 9;
  const CH_SCALE = 10; // scale channel values by 2^10
  const CHSCALE_TINT0 = 0x7517; // 322/11 * 2^CH_SCALE
  const CHSCALE_TINT1 = 0x0fe7 // 322/81 * 2^CH_SCALE

  const K1T = 0x0040; // 0.125 * 2^RATIO_SCALE
  const B1T = 0x01f2; // 0.0304 * 2^LUX_SCALE
  const M1T = 0x01be; // 0.0272 * 2^LUX_SCALE

  const K2T = 0x0080; // 0.250 * 2^RATIO_SCALE
  const B2T = 0x0214;
  const M2T = 0x02d1;

  const K3T = 0x00c0;
  const B3T = 0x023f;
  const M3T = 0x037b;

  const K4T = 0x0100;
  const B4T = 0x0270;
  const M4T = 0x03fe;

  const K5T = 0x0138;
  const B5T = 0x016f;
  const M5T = 0x01fc;

  const K6T = 0x019a;
  const B6T = 0x00d2;
  const M6T = 0x00fb;

  const K7T = 0x029a;
  const B7T = 0x0018;
  const M7T = 0x0012;

  const K8T = 0x029a;
  const B8T = 0x0000;
  const M8T = 0x0000;

  function calculateLux(ch0, ch1, tInt, gain) {
    let chScale = 0;

    switch (tInt) {
      case 0:
        chScale = CHSCALE_TINT0;
        break;
      case 1:
        chScale = CHSCALE_TINT1;
        break;
      default:
        chScale = (1 << CH_SCALE);
        break;
    }

    if (!gain) {
      chScale = chScale << 4;
    }

    let channel0 = (ch0 * chScale) >> CH_SCALE;
    let channel1 = (ch1 * chScale) >> CH_SCALE;

    let ratio1 = 0;
    if (channel0) {
      ratio1 = (channel1 << (RATIO_SCALE + 1)) / channel0;
    }

    let ratio = (ratio1 + 1) >> 1;

    let b = 0, m = 0;

    if ((ratio >= 0) && (ratio <= K1T)) {
      b = B1T;
      m = M1T;
    } else if (ratio <= K2T) {
      b = B2T;
      m = M2T;
    } else if (ratio <= K3T) {
      b = B3T;
      m = M3T;
    } else if (ratio <= K4T) {
      b = B4T;
      m = M4T;
    } else if (ratio <= K5T) {
      b = B5T;
      m = M5T;
    } else if (ratio <= K6T) {
      b = B6T;
      m = M6T;
    } else if (ratio <= K7T) {
      b = B7T;
      m = M7T;
    } else if (ratio <= K8T) {
      b = B8T;
      m = M8T;
    }

    let tLux = (channel0 * b) - (channel1 * m);
    if (tLux < 0) {
      tLux = 0;
    }
    tLux += (1 << (LUX_SCALE - 1));
    return tLux >> LUX_SCALE;
  }
}

