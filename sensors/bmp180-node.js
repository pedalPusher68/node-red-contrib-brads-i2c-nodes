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

  'use strict';
  // require any external libraries we may need....
  // Node.js Imports
  const os = require('os');
  // NPM Imports
  const i2c = require('i2c-bus');
  const BigNumber = require('bignumber.js');

  // Local Imports
  const Util = require('./util.js');

  const BMP180Address = 0x77;

  // BMP180 Constants:
  const REGISTER_DEVICE_ID = 0xd0;
  const REGISTER_RESET = 0xe0;
  const REGISTER_CTRL_MEAS = 0xf4;
  const REGISTER_ADC_OUT_MSB = 0xf6;
  const REGISTER_ADC_OUT_LSB = 0xf7;
  const REGISTER_ADC_OUT_XLSB = 0xf8;

  const CALIBRATION_PARAMS_ADDRESS = 0xaa;

  const SCO_BIT_MASK = 0b00100000;
  const OSS_BIT_MASK = 0b11000000;
  const CTRL_MEAS_BIT_MASK = 0b00011111;

  const CTRL_MEAS_TEMP = 0x2e; // 4.5 ms
  const CTRL_MEAS_PRESS_OSS0 = 0x34; // 4.5 ms
  const CTRL_MEAS_PRESS_OSS1 = 0x74; // 7.5 ms
  const CTRL_MEAS_PRESS_OSS2 = 0xb4; // 13.5 ms
  const CTRL_MEAS_PRESS_OSS3 = 0xf4; // 25.5 ms

  const P_OVERSAMPLINGS = new Map();
  P_OVERSAMPLINGS.set(CTRL_MEAS_PRESS_OSS0, {
    timeMs: 5,
    value: CTRL_MEAS_PRESS_OSS0,
    oss: 0,
    samples: 1
  });
  P_OVERSAMPLINGS.set(CTRL_MEAS_PRESS_OSS1, {
    timeMs: 8,
    value: CTRL_MEAS_PRESS_OSS1,
    oss: 1,
    samples: 2
  });
  P_OVERSAMPLINGS.set(CTRL_MEAS_PRESS_OSS2, {
    timeMs: 14,
    value: CTRL_MEAS_PRESS_OSS2,
    oss: 2,
    samples: 4
  });
  P_OVERSAMPLINGS.set(CTRL_MEAS_PRESS_OSS3, {
    timeMs: 26,
    value: CTRL_MEAS_PRESS_OSS3,
    oss: 3,
    samples: 8
  });


  let i2cBus = undefined;

  function bmp180(config) {

    RED.nodes.createNode(this, config);

    let node = this;

    // 1. Process Config
    node.debugMode = (config && config.debugMode);

    function debug(msg) {
      if (node.debugMode) {
        node.log(msg);
      }
    }

    debug(JSON.stringify(config));

    node.address = BMP180Address;
    node.name = `BMP180 @ 0x${node.address.toString(16)}`;
    node.topic = config.topic;

    node.presolution = Number(config.presolution);
    node.p_oversampling = P_OVERSAMPLINGS.get(node.presolution);
    if (node.p_oversampling === undefined) {
      node.p_oversampling = P_OVERSAMPLINGS.get(CTRL_MEAS_PRESS_OSS3);
      // throw(`Unable to process presolution=${node.presolution}`);
    } else {
      debug(`node.p_oversampling -> ${JSON.stringify(node.p_oversampling)}`);
    }

    node.haveCalibrationData = false;
    node.AC1 = 0;
    node.AC2 = 0;
    node.AC3 = 0;
    node.AC4 = 0;
    node.AC5 = 0;
    node.AC6 = 0;
    node.B1 = 0;
    node.B2 = 0;
    node.MB = 0;
    node.MC = 0;
    node.MD = 0;

    // open i2c bus if necessary
    if (i2cBus == undefined) {
      i2cBus = i2c.openSync(1);
    }

    node.ready = false;
    // Setup device, get calibration, etc.
    node.deviceId = undefined;

    let p1 = new Promise((resolve, reject) => {

      i2cBus.readByte(node.address, REGISTER_DEVICE_ID, (err, byteRead) => {
        if (err) {
          let errResult = `read REGISTER_DEVICE_ID (0x${REGISTER_DEVICE_ID.toString(16)}) error:  ${err}`;
          node.error(errResult);
          reject(errResult);
        } else {
          node.deviceId = byteRead;
          resolve(`${node.name} Device ID:  0x${node.deviceId.toString(16)}  (expected 0x55)${os.EOL}`);
        }
      });
    });

    // get calibration parameters
    let p2 = new Promise((resolve, reject) => {
      let buffer = new Uint8Array(11 * 2 /* 12 coefficients, 2 bytes each */);
      i2cBus.readI2cBlock(node.address, CALIBRATION_PARAMS_ADDRESS, buffer.length, buffer, (err, bytesRead, buffer) => {
        if (err) {
          let errResult = `${node.name} read calibration parameters error:  ${err}`;
          node.error(errResult);
          reject(errResult);
        } else {
          let dataView = new DataView(buffer.buffer);
          let i = 0;
          node.AC1 = dataView.getInt16(i);
          node.AC2 = dataView.getInt16(i += 2);
          node.AC3 = dataView.getInt16(i += 2);
          node.AC4 = dataView.getUint16(i += 2);
          node.AC5 = dataView.getUint16(i += 2);
          node.AC6 = dataView.getUint16(i += 2);
          node.B1 = dataView.getInt16(i += 2);
          node.B2 = dataView.getInt16(i += 2);
          node.MB = dataView.getInt16(i += 2);
          node.MC = dataView.getInt16(i += 2);
          node.MD = dataView.getInt16(i += 2);
          node.haveCalibrationData = true;

          i = 0x88;
          let r = os.EOL + 'bmp180 calibration parameters loaded.' + os.EOL
            + 'Calibration Address:  0x' + i.toString(16) + (i + 1).toString(16) + Util.printHexWord('   AC1', node.AC1) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   AC2', node.AC2) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   AC3', node.AC3) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   AC4', node.AC4) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   AC5', node.AC5) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   AC6', node.AC6) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   B1', node.B1) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   B2', node.B2) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   MB', node.MB) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   MC', node.MC) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   MD', node.MD) + os.EOL;
          debug(r);
          resolve(r);
        }
      });
    });

    node.status({fill: "green", shape: "ring", text: "setting up bmp180..."});
    Promise.all([p1, p2]).then((resolve) => {
      node.ready = !!(node.haveCalibrationData && node.deviceId);
      node.status({fill: "green", shape: "dot", text: "bmp180 ready"});
      node.log(`${node.name} ready.`);
    }, (reject) => {
      node.status({fill: "red", shape: "ring", text: "check configuration"});
      node.error(`${reject}:  node.ready -> ${node.ready}:  node.haveCalibrationData -> ${node.haveCalibrationData}, node.deviceId -> ${node.deviceId}`);
    });

    // respond to inputs....
    this.on('input', (msg) => {
      if ("measure" == msg.payload) {
        msg.topic = node.topic;
        if (node.ready) {

          measure().then((resolve) => {
            debug(JSON.stringify(resolve));

            let thingShadow = {
              state: {
                "reported": {
                  "device": "sensor",
                  "name": "bmp180",
                }
              }
            };

            node.send([
              {topic: 'bmp180', payload: resolve},
              {topic: 'bmp180', payload: thingShadow}
            ]);

          }, (reject) => {
            msg.payload = `${reject}`;
            node.send(msg);
          });
        } else {
          msg.payload = `${node.name} device is not ready - skipping measurement.`;
        }
      } else {
        msg.payload = `${msg.payload} unrecognized command.`;
      }
      debug(JSON.stringify(msg));

      node.send(msg);
    });

    function measure() {
      debug(' measure() ...');

      let buffer = new Uint8Array(3);
      let timestamp;
      let UT = 0;
      let UP = 0;
      let T = 0;
      let P = 0;

      return new Promise((resolve, reject) => {
        i2cBus.writeByte(node.address, REGISTER_CTRL_MEAS, CTRL_MEAS_TEMP, (err) => {
          if (err) {
            let errMsg = `Failed to write CTRL_MEAS_TEMP (0x${CTRL_MEAS_TEMP})  node.address -> 0x${node.address.toString(16)}, REGISTER_CTRL_MEAS -> 0x${REGISTER_CTRL_MEAS.toString(16)}${os.EOL}Error:  ${err}`;
            node.error(errMsg);
            reject(errMsg);
          } else {
            resolve(`0b${CTRL_MEAS_TEMP.toString(2)} sent.`);
          }
        });
      }).then((resolved) => {
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            i2cBus.readI2cBlock(node.address, REGISTER_ADC_OUT_MSB, buffer.length, buffer, (err, bytesRead, buffer) => {
              if (err) {
                let errMsg = `Failed to read temperature bytes.  Error:  ${err}`;
                node.error(errMsg);
                reject(errMsg);
              } else {
                UT = ((buffer[0] & 0xff) << 8) | (buffer[1] & 0xff);
                resolve(`UT -> 0x${UT.toString(16)},\t0b${UT.toString(2)},\t${UT}`);
              }
            });
          }, 5 /* ms */);
        });
      }).then((resolved) => {
        return new Promise((resolve, reject) => {
          let CTRL_MEAS_PRESS = node.p_oversampling.value;
          i2cBus.writeByte(node.address, REGISTER_CTRL_MEAS, CTRL_MEAS_PRESS, (err) => {
            if (err) {
              let errMsg = `Failed to write CTRL_MEAS_PRESS (0x${CTRL_MEAS_PRESS})  node.address -> 0x${node.address.toString(16)}, REGISTER_CTRL_MEAS -> 0x${REGISTER_CTRL_MEAS.toString(16)}${os.EOL}Error:  ${err}`;
              node.error(errMsg);
              reject(errMsg);
            } else {
              resolve(`0b${CTRL_MEAS_PRESS.toString(2)} sent.`);
            }
          });
        });
      }).then((resolved) => {
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            i2cBus.readI2cBlock(node.address, REGISTER_ADC_OUT_MSB, buffer.length, buffer, (err, bytesRead, buffer) => {
              if (err) {
                let errMsg = `Failed to read pressure bytes.  Error:  ${err}`;
                node.error(errMsg);
                reject(errMsg);
              } else {
                timestamp = Util.getTimestamp();
                debug(`8-node.p_oversampling.oss -> ${8 - node.p_oversampling.oss}`);
                UP = (((buffer[0] & 0xff) << 16) | ((buffer[1] & 0xff) << 8) | ((buffer[2] & 0xff))) >>> (8 - node.p_oversampling.oss);
                let UPBytes = os.EOL;
                UPBytes += `UP bytes:  0b${(buffer[0] & 0xff).toString(2)} 0b${(buffer[1] & 0xff).toString(2)} 0b${(buffer[2] & 0xff).toString(2)}`
                UPBytes += os.EOL;
                UPBytes += `           0x${(buffer[0] & 0xff).toString(16)} 0x${(buffer[1] & 0xff).toString(16)} 0x${(buffer[2] & 0xff).toString(16)}`
                debug(UPBytes);
                debug(`UP -> 0x${UP.toString(16)},\t0b${UP.toString(2)},\t${UP}`);
                resolve(`UP -> 0x${UP.toString(16)},\t0b${UP.toString(2)},\t${UP}`);
              }
            });
          }, node.p_oversampling.timeMs /* ms */);
        });
      }).then((resolved) => {
        return new Promise((resolve) => {
          debug(`UT -> ${UT},\tUP -> ${UP}`);
          // compensate temperature
          let x1 = (UT - node.AC6) * node.AC5 / 32768;
          debug(`ct:  x1 -> ${x1}`);
          let x2 = 2048 * node.MC / ( x1 + node.MD);
          debug(`ct:  x2 -> ${x2}`);
          let b5 = x1 + x2;
          debug(`ct:  b5 -> ${b5}`);
          T = ((b5 + 8) / 16) / 10; // divide by ten because the device computes T in units of 0.1 deg. C
          debug(`ct:  T -> ${T}`);
          // compensate pressure
          let b6 = b5 - 4000;
          debug(`cp:  b6 -> ${b6}`);
          x1 = (node.B2 * (b6 * b6 / 4096)) / 2048;
          debug(`cp:  x1 -> ${x1}`);
          x2 = node.AC2 * b6 / 2048;
          debug(`cp:  x2 -> ${x2}`);
          let x3 = x1 + x2;
          debug(`cp:  x3 -> ${x3}`);
          let b3 = (((node.AC1 * 4 + x3) << node.p_oversampling.oss) + 2) / 4;
          debug(`cp:  b3 -> ${b3}`);
          x1 = node.AC3 * b6 / 8192;
          debug(`cp:  x1 -> ${x1}`);
          x2 = (node.B1 * (b6 * b6 / 4096)) / 65536;
          debug(`cp:  x2 -> ${x2}`);
          x3 = ((x1 + x2) + 2) / 4;
          debug(`cp:  x3 -> ${x3}`);
          debug(`50000 >> node.p_oversampling.oss -> ${50000 >> node.p_oversampling.oss}`);
          let b4 = (node.AC4 * (x3 + 32768) / 32768) >>> 0;
          debug(`cp:  b4 -> ${b4}`);
          let b7 = ((((UP >>> 0) - b3) >>> 0) * (50000 >> node.p_oversampling.oss)) >>> 0;
          debug(`cp:  b7 -> ${b7}`);
          let p = 0;
          if (b7 < (0x80000000 >>> 0)) {
            p = (((b7 >>> 0) * 2) / b4) >>> 0;
            debug(`cp:  p -> ${p} (b7 < 0x80000000)`);
          } else {
            p = ((b7 / b4) * 2) >>> 0;
            debug(`cp:  p -> ${p} (b7 >= 0x80000000)`);
          }
          x1 = (p / 256) * (p / 256);
          debug(`cp:  x1 -> ${x1}`);
          x1 = (x1 * 3038) / 65536;
          debug(`cp:  x1 -> ${x1}`);
          x2 = (-7357 * p) / 65536;
          debug(`cp:  x2 -> ${x2}`);
          p = p + (x1 + x2 + 3791) / 16;
          debug(`cp:  p -> ${p}`);

          let alt = Util.computeAltitude(p);

          let rsv = {
            'name': node.name, 'timestamp': timestamp,
            'Tc': Util.roundValue(T), 'Tf': Util.roundValue(T * 1.8 + 32),
            'p': Util.roundValue(p), 'P': Util.roundValue(p / 3386.39),
            'altm': Util.roundValue(alt), 'altf': Util.roundValue(alt / 3.280839895)
          };
          resolve(rsv);
        });
      });

    }

  }

  RED.nodes.registerType("bmp180", bmp180);

}