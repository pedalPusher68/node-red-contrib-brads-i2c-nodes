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

  // BME280 Constants:
  const REGISTER_DEVICE_ID = 0xd0;
  const REGISTER_RESET = 0xe0;
  const REGISTER_CTRL_HUM = 0xf2;
  const REGISTER_STATUS = 0xf3;
  const REGISTER_CTRL_MEAS = 0xf4;
  const REGISTER_CONFIG = 0xf5;
  const REGISTER_PRESSURE_MSB = 0xf7;
  const REGISTER_PRESSURE_LSB = 0xf8;
  const REGISTER_PRESSURE_XLSB = 0xf9;
  const REGISTER_TEMPERATURE_MSB = 0xfa;
  const REGISTER_TEMPERATURE_LSB = 0xfb;
  const REGISTER_TEMPERATURE_XLSB = 0xfc;
  const REGISTER_HUMIDITY_MSB = 0xfd;
  const REGISTER_HUMIDITY_LSB = 0xfe;

  const CALIBRATION_PARAMS_ADDRESS1 = 0x88; // 25 bytes to read
  const CALIBRATION_PARAMS_ADDRESS2 = 0xe1; // 8 bytes to read

  // Pressure & temperature oversampling control values:
  const POWER_MODE_SLEEP = 0;
  const POWER_MODE_FORCED_1 = 1;
  const POWER_MODE_FORCED_2 = 2;
  const POWER_MODE_NORMAL = 3;

  const T_OVERSAMPLINGS = new Map();
  T_OVERSAMPLINGS.set(32, {
    display: '+/- 0.0050 \u2103',
    displayF: '+/- 0.0090 \u2109',
    timeMs: 7,
    value: 0.005,
    bits: 32
  });
  T_OVERSAMPLINGS.set(64, {
    display: '+/- 0.0025 \u2103',
    displayF: '+/- 0.0045 \u2109',
    timeMs: 9,
    value: 0.0025,
    bits: 64
  });
  T_OVERSAMPLINGS.set(96, {
    display: '+/- 0.0012 \u2103',
    displayF: '+/- 0.00225 \u2109',
    timeMs: 14,
    value: 0.00125,
    bits: 96
  });
  T_OVERSAMPLINGS.set(128, {
    display: '+/- 0.0006 \u2103',
    displayF: '+/- 0.0001 \u2109',
    timeMs: 23,
    value: 0.000625,
    bits: 128
  });
  T_OVERSAMPLINGS.set(160, {
    display: '+/- 0.0003 \u2103',
    displayF: '+/- 0.0006 \u2109',
    timeMs: 44,
    value: 0.0003125,
    bits: 160
  });

  const P_OVERSAMPLINGS = new Map();
  P_OVERSAMPLINGS.set(4, {
    display: '+/- 2.62 Pa',
    displayHg: '+/- 0.00077 inches Hg',
    timeMs: 7,
    value: 2.62,
    bits: 4
  });
  P_OVERSAMPLINGS.set(8, {
    display: '+/- 1.31 Pa',
    displayHg: '+/- 0.00039 inches Hg',
    timeMs: 9,
    value: 1.31,
    bits: 8
  });
  P_OVERSAMPLINGS.set(12, {
    display: '+/- 0.66 Pa',
    displayHg: '+/- 0.00020 inches Hg',
    timeMs: 14,
    value: 0.66,
    bits: 12
  });
  P_OVERSAMPLINGS.set(16, {
    display: '+/- 0.33 Pa',
    displayHg: '+/- 0.00010 inches Hg',
    timeMs: 23,
    value: 0.33,
    bits: 16
  });
  P_OVERSAMPLINGS.set(20, {
    display: '+/- 0.16 Pa',
    displayHg: '+/- 0.00005 inches Hg',
    timeMs: 44,
    value: 0.16,
    bits: 20
  });

  const H_OVERSAMPLINGS = new Map();
  H_OVERSAMPLINGS.set(0, {
    timeMs: 0,
  });
  H_OVERSAMPLINGS.set(1, {
    timeMs: 3,
  });
  H_OVERSAMPLINGS.set(2, {
    timeMs: 6,
  });
  H_OVERSAMPLINGS.set(3, {
    timeMs: 10,
  });
  H_OVERSAMPLINGS.set(4, {
    timeMs: 19,
  });
  H_OVERSAMPLINGS.set(5, {
    timeMs: 38,
  });

  const dateFormatOptions = {
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false, timeZone: 'America/New_York'
  };

  let i2cBus = undefined;

  function bme280(config) {

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

    node.address = Number(config.address);
    debug(`bme280 address:  0x${node.address.toString(16)}`);

    // Store local copies of the node configuration (as defined in the .html)
    // process config values and throw errors if necessary
    node.name = `BME280 @ 0x${node.address.toString(16)}`;
    node.topic = config.topic;
    node.powermode = Number(config.powermode);
    node.tresolution = Number(config.tresolution);
    node.t_oversampling = T_OVERSAMPLINGS.get(node.tresolution);
    if (node.t_oversampling === undefined) {
      throw(`Unable to process tresolution=${node.tresolution}`);
    } else {
      debug(`node.t_oversampling -> ${JSON.stringify(node.t_oversampling)}`);
    }
    node.presolution = Number(config.presolution);
    node.p_oversampling = P_OVERSAMPLINGS.get(node.presolution);
    if (node.p_oversampling === undefined) {
      throw(`Unable to process presolution=${node.presolution}`);
    } else {
      debug(`node.p_oversampling -> ${JSON.stringify(node.p_oversampling)}`);

    }
    node.hresolution = Number(config.hresolution);
    node.h_oversampling = H_OVERSAMPLINGS.get(node.hresolution);
    if (node.h_oversampling === undefined) {
      throw(`Unable to process hresolution=${node.hresolution}`);
    } else {
      debug(`node.hresolution -> ${node.hresolution}`);
      debug(`node.h_oversampling -> ${JSON.stringify(node.h_oversampling)}`);
      node.ctrl_hum = node.hresolution;
      node.ctrl_meas = node.tresolution + node.presolution + node.powermode;
      debug(`ctrl_hum = ${node.ctrl_hum.toString(2)} (0x${node.ctrl_hum.toString(16)})`);
      debug(`ctrl_meas = ${node.ctrl_meas.toString(2)} (0x${node.ctrl_meas.toString(16)})`);
    }

    // Calibration Data
    node.haveCalibrationData1 = false;
    node.haveCalibrationData2 = false;
    node.haveCalibrationData = false;
    node.digT1 = 0;
    node.digT2 = 0;
    node.digT3 = 0;
    node.digP1 = 0;
    node.digP2 = 0;
    node.digP3 = 0;
    node.digP4 = 0;
    node.digP5 = 0;
    node.digP6 = 0;
    node.digP7 = 0;
    node.digP8 = 0;
    node.digP9 = 0;
    node.digH1 = 0;
    node.digH2 = 0;
    node.digH3 = 0;
    node.digH4 = 0;
    node.digH5 = 0;
    node.digH6 = 0;

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
          resolve(`${node.name} Device ID:  0x${node.deviceId.toString(16)}  (expected 0x60)${os.EOL}`);
        }
      });
    });

    // get calibration parameters set 1 (1 of 2)
    let p2 = new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(12 * 2 + 1 /* 12 coefficients, 2 bytes each + 1 byte*/); //new Uint8Array(12 * 2 + 1 /* 12 coefficients, 2 bytes each + 1 byte*/);
      i2cBus.readI2cBlock(node.address, CALIBRATION_PARAMS_ADDRESS1, buffer.length, buffer, (err, bytesRead, buffer) => {
        if (err) {
          let errResult = `${node.name} read calibration parameters error:  ${err}`;
          node.error(errResult);
          reject(errResult);
        } else {
          let dataView = new DataView(buffer.buffer);
          let i = 0;
          node.digT1 = dataView.getUint16(i, true);
          node.digT2 = dataView.getInt16(i += 2, true);
          node.digT3 = dataView.getInt16(i += 2, true);
          node.digP1 = dataView.getUint16(i += 2, true);
          node.digP2 = dataView.getInt16(i += 2, true);
          node.digP3 = dataView.getInt16(i += 2, true);
          node.digP4 = dataView.getInt16(i += 2, true);
          node.digP5 = dataView.getInt16(i += 2, true);
          node.digP6 = dataView.getInt16(i += 2, true);
          node.digP7 = dataView.getInt16(i += 2, true);
          node.digP8 = dataView.getInt16(i += 2, true);
          node.digP9 = dataView.getInt16(i += 2, true);
          node.digH1 = dataView.getUint8(i);
          node.haveCalibrationData1 = true;

          i = 0x88;
          let r = os.EOL + 'bme280 calibration parameters loaded.' + os.EOL
            + 'Calibration Address:  0x' + i.toString(16) + (i + 1).toString(16) + Util.printHexWord('   digT1', node.digT1) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digT2', node.digT2) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digT3', node.digT3) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digP1', node.digP1) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digP2', node.digP2) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digP3', node.digP3) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digP4', node.digP4) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digP5', node.digP5) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digP6', node.digP6) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digP7', node.digP7) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digP8', node.digP8) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digP9', node.digP9) + os.EOL;
          debug(r);

          resolve(r);
        }
      });
    });

    // get calibration parameters set 2 (2 of 2)
    let p3 = new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(7); //new Uint8Array(7);
      i2cBus.readI2cBlock(node.address, CALIBRATION_PARAMS_ADDRESS2, buffer.length, buffer, (err, bytesRead, buffer) => {
        if (err) {
          let errResult = `${node.name} read calibration parameters error:  ${err}`;
          node.error(errResult);
          reject(errResult);
        } else {
          let dataView = new DataView(buffer.buffer);
          let i = 0;
          if (node.debugMode) {
            let H = 'H Coefficients:' + os.EOL;
            let idx = 0xe1, c = 1;
            for (let b of buffer) {
              H += `digH${c}:  address:  ${idx.toString(16)}, value:  0x${b.toString(16)} (0b${b.toString(2)} }${os.EOL}`;
              idx++;
              c++;
            }
            debug(H);
          }
          node.digH2 = dataView.getInt16(i, true);
          node.digH3 = dataView.getUint8(i += 2);

          let xE4 = dataView.getUint8(i += 1);
          let xE5 = dataView.getUint8(i += 1);
          node.digH4 = (xE4 << 4) | ( xE5 & 0x0f);

          let xE6 = dataView.getUint8(i += 1);
          node.digH5 = ((xE5 & 0xf0) << 4) | xE6;
          node.digH6 = dataView.getInt8(i);
          node.haveCalibrationData2 = true;

          i = 0xe1;
          let r = os.EOL + 'bme280 calibration parameters loaded.' + os.EOL
            + 'Calibration Address:  0xa1' + Util.printHexWord('   digH1', node.digH1) + os.EOL
            + 'Calibration Address:  0x' + (i).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digH2', node.digH2) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digH3', node.digH3) + os.EOL
            + 'Calibration Address:  0x' + (i += 1).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digH4', node.digH4) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digH5', node.digH5) + os.EOL
            + 'Calibration Address:  0x' + (i).toString(16) + (i + 1).toString(16) + Util.printHexWord('   digH6', node.digH6) + os.EOL;
          debug(r);

          resolve(r);
        }
      });
    });

    debug("about to do Promise.all(...)");
    node.status({fill: "green", shape: "ring", text: "setting up bme280..."});
    Promise.all([p1, p2, p3]).then((resolve) => {
      node.haveCalibrationData = node.haveCalibrationData1 & node.haveCalibrationData2;
      node.ready = !!(node.haveCalibrationData && node.deviceId);
      node.status({fill: "green", shape: "dot", text: "bme280 ready"});
      debug(`node.haveCalibrationData1 -> ${node.haveCalibrationData1}\tnode.haveCalibrationData2 -> ${node.haveCalibrationData2}\tnode.haveCalibrationData -> ${node.haveCalibrationData}\tnode.ready -> ${node.ready}`);
      debug(`${node.name} ready.`);

    }, (reject) => {
      node.status({fill: "red", shape: "ring", text: "check configuration"});
      node.error(`${reject}:  node.ready -> ${node.ready}:  node.haveCalibrationData -> ${node.haveCalibrationData}, node.deviceId -> ${node.deviceId}`);
    });

    // respond to inputs....
    this.on('input', (msg) => {
      if ("measure" == msg.payload) {
        msg.topic = node.topic;
        if (node.ready) {

          measure(node).then((resolve) => {
            debug(JSON.stringify(resolve));

            let thingShadow = {
              state: {
                "reported": {
                  "device": "sensor",
                  "name": "bme280",
                  "temperature": resolve.Tf,
                  "temperatureUnits": "degrees Fahrenheit",
                  "pressureHg": resolve.P,
                  "relativeHumidity": resolve.RH,
                  "timestamp": resolve.timestamp
                }
              }
            };

            node.send([
              {topic: 'bme280', payload: resolve},
              {topic: 'bme280', payload: thingShadow}
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

    this.on("close", () => {
      // Called when the node is shutdown - eg on redeploy.
      // Allows ports to be closed, connections dropped etc.
      // eg: node.client.disconnect();
      debug(`${node.name} received 'close' event.`);

    });

    /**
     *
     * @param adc_T
     */
    function compensateTemperature(adc_T) {
      let var1 = (adc_T / 8 - 2 * node.digT1) * node.digT2 / 2048;
      debug(`ct:  var1 = ${var1}`);

      let var2 = ((Math.pow((adc_T / 16 - node.digT1), 2) / 4096) * node.digT3) / 16384;
      debug(`ct:  var2 = ${var2}`);

      let t_fine = var1 + var2;
      debug(`ct:  t_fine = ${t_fine}`);

      let T = (t_fine * 5 + 128) / 256;
      debug(`ct:  T (x100) = ${T}`);

      T = T / 100.00;
      debug(`${node.name}:  T = ${T} -> ${T * 1.8 + 32}`);

      return {'t_fine': Util.roundValue(t_fine), 'Tc': Util.roundValue(T), 'Tf': Util.roundValue(T * 1.8 + 32)};
    }

    function compensatePressure(adc_P, t_fine) {
      debug(`cp:  adc_P = ${adc_P}, t_fine = ${t_fine}`);

      let var1 = t_fine - 128000;
      debug(`cp:  var1 = ${var1}`);

      let var2 = var1 * var1 * node.digP6;
      debug(`cp:  var2 = ${var2}`);

      var2 = var2 + ( var1 * node.digP5 * 131072 );
      debug(`cp:  var2 = ${var2}`);

      var2 = var2 + ( node.digP4 * Math.pow(2, 35) );
      debug(`cp:  var2 = ${var2}`);

      var1 = (var1 * var1 * node.digP3) / 256 + var1 * node.digP2 * 4096;
      debug(`cp:  var1 = ${var1}`);

      var1 = ((var1 + Math.pow(2, 47)) * node.digP1) / 8589934592;
      debug(`cp:  var1 = ${var1}`);

      let p = 0;
      if (var1 !== 0) {
        p = 1048576 - adc_P;
        debug(`cp:  p = ${p}`);

        p = (p * 2147483648 - var2) * 3125 / var1;
        debug(`cp:  p = ${p}`);

        var1 = ( node.digP9 * Math.pow(p / 8192, 2) ) / 33554432;
        debug(`cp:  var1 = ${var1}`);

        var2 = (node.digP8 * p) / 524288;
        debug(`cp:  var2 = ${var2}`);

        p = (p + var1 + var2) / 256 + (node.digP7 * 16);
        debug(`cp:  p = ${p}`);

        p = p / 256;
        debug(`cp:  p = ${p}`);

        debug(`cp:  P = ${p / 3386.39}`);

      }
      return {'p': Util.roundValue(p), 'P': Util.roundValue(p / 3386.39)};
    }

    function compensateHumidity(adc_H, t_fine) {
      t_fine = (typeof t_fine === 'number') ? t_fine.toNumber() : t_fine;
      let var_H = t_fine - 76800;
      var_H = (adc_H - (node.digH4 * 64.0 + node.digH5 / 16384.0 * var_H)) *
        (node.digH2 / 65536.0 * (1.0 + node.digH6 / 67108864.0 * var_H *
        (1.0 + node.digH3 / 67108864.0 * var_H)));
      var_H = var_H * (1.0 - node.digH1 * var_H / 524288.0);

      debug(`${node.name}:  RH (raw) = ${Util.roundValue(var_H)} %`);

      if (var_H > 100) {
        var_H = '100.00';
      } else if (var_H < 0) {
        var_H = '0.00';
      } else {
        var_H = Util.roundValue(var_H);
      }
      debug(`${node.name}:  RH = ${var_H} %`);

      return {'RH': var_H};
    }

    function compensateHumidity2(adc_H, t_fine) {

      debug(`ch2:  adc_H -> ${adc_H},\tt_fine -> ${t_fine}`);
      let var1 = t_fine - 76800.0;
      debug(`ch2:  var1 -> ${var1}`);
      let var2 = (node.digH4 * 64.0 + (node.digH5 / 16384.0) * var1);
      debug(`ch2:  var2 -> ${var2}`);
      let var3 = adc_H - var2;
      debug(`ch2:  var3 -> ${var3}`);
      let var4 = node.digH2 / 65536.0;
      debug(`ch2:  var4 -> ${var4}`);
      let var5 = (1.0 + (node.digH3 / 67108864.0) * var1);
      debug(`ch2:  var5 -> ${var5}`);
      let var6 = 1.0 + (node.digH6 / 67108864.0) * var1 * var5;
      debug(`ch2:  var6 -> ${var6}`);
      var6 = var3 * var4 * (var5 * var6);
      debug(`ch2:  var6 -> ${var6}`);
      let humidity = var6 * (1.0 - node.digH1 * var6 / 524288.0);
      debug(`ch2:  humidity -> ${humidity}`);

      if (humidity > 100.0) {
        humidity = 100.0;
      } else if (humidity < 0) {
        humidity = 0;
      }

      return humidity;

    }

    function measure() {
      debug(' measure() ...');

      let buffer = Buffer.alloc(8); //new Uint8Array(8);
      let timeToWait = getMaxMeasureTime(node.tresolution, node.presolution, node.hresolution);
      debug(`timeToWait -> ${timeToWait} ms`);


      return new Promise((resolve, reject) => {

        //bus.writeByte(addr, cmd, byte, cb)
        i2cBus.writeByte(node.address, REGISTER_CTRL_HUM, node.ctrl_hum, (err) => {
          if (err) {
            let errMsg = `Failed to write ctrl_hum:  node.address -> 0x${node.address.toString(16)}, REGISTER_CTRL_HUM -> 0x${REGISTER_CTRL_HUM.toString(16)}, node.ctrl_hum -> 0b${node.ctrl_hum.toString(2)}`;
            node.error(errMsg);
            reject(errMsg);
          } else {
            resolve(`0b${node.ctrl_hum.toString(2)} sent.`);
          }
        });
      }).then((resolved) => {
        return new Promise((resolve, reject) => {
          i2cBus.writeByte(node.address, REGISTER_CTRL_MEAS, node.ctrl_meas, (err) => {
            if (err) {
              let errMsg = `Failed to write ctrl_meas:  node.address -> 0x${node.address.toString(16)}, REGISTER_CTRL_MEAS -> 0x${REGISTER_CTRL_MEAS.toString(16)}, node.ctrl_meas -> 0b${node.ctrl_meas.toString(2)}`;
              node.error(errMsg);
              reject(errMsg);
            } else {
              resolve(`0b${node.ctrl_meas.toString(2)} sent.`);
            }
          });
        });
      }).then((resolved) => {
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            i2cBus.readI2cBlock(node.address, REGISTER_PRESSURE_MSB, buffer.length, buffer, (err, bytesRead, buffer) => {
              if (err) {
                let errMsg = `ERROR - ${node.name} measure send command error:  ${err}`;
                node.error(errMsg);
                reject(errMsg);
              } else {
                let timestamp = new Date().toLocaleString('en-US', dateFormatOptions);
                node.adc_Pi = ((buffer[0] & 0xff) << 12) | ((buffer[1] & 0xff) << 4) | ((buffer[2] & 0xf0) >> 4);
                node.adc_Ti = ((buffer[3] & 0xff) << 12) | ((buffer[4] & 0xff) << 4) | ((buffer[5] & 0xf0) >> 4);
                node.adc_H = ((buffer[6] & 0xff) << 8) | (buffer[7] & 0xff);
                let T = compensateTemperature(node.adc_Ti);
                let P = compensatePressure(node.adc_Pi, T.t_fine);
                let RH = compensateHumidity(node.adc_H, T.t_fine);
                compensateHumidity2(node.adc_H, T.t_fine);
                let DPc = Util.roundValue(Util.computeDewpoint(T.Tc, RH.RH));
                let DPf = Util.roundValue(DPc * 1.8 + 32.0);
                let Alt = Util.roundValue(Util.computeAltitude(P.p));

                if (node.debugMode) {
                  debug(`${node.name} bytes read -> ${bytesRead}.`);
                  let dump = os.EOL;
                  dump += `   Pressure Bytes (MSB, LSB, XLSB):  0x${buffer[0].toString(16)} 0x${buffer[1].toString(16)} 0x${buffer[2].toString(16)}\tadc_Pi ->${node.adc_Pi.toString(16)} (${node.adc_Pi})${os.EOL}`;
                  dump += `Temperature Bytes (MSB, LSB, XLSB):  0x${buffer[3].toString(16)} 0x${buffer[4].toString(16)} 0x${buffer[5].toString(16)}\tadc_Ti ->${node.adc_Ti.toString(16)} (${node.adc_Ti})${os.EOL}`;
                  dump += `         Humidity Bytes (MSB, LSB):  0x${buffer[6].toString(16)} 0x${buffer[7].toString(16)}     \t adc_H ->${node.adc_H.toString(16)} (${node.adc_H})${os.EOL}`;
                  debug(dump);
                  debug(JSON.stringify(T));
                  debug(JSON.stringify(P));
                  debug(JSON.stringify(RH));
                  debug(`Dew Point:  ${DPc}, ${DPf}`);
                }
                let rsv = {'name': node.name, 'timestamp': timestamp};
                rsv = Object.assign(rsv, T, P, RH, {'DPc': DPc, 'DPf': DPf, 'Alt': Alt});
                delete rsv.t_fine;
                resolve(rsv);
              }
            });
          }, timeToWait);
        });
      });
    }

    function getTypicalMeasureTime(t_oversampling, p_oversampling, h_oversampling) {
      let t = 1; // ms
      if (t_oversampling) {
        t += 2 * t_oversampling;
      }
      if (p_oversampling) {
        t += 2 * p_oversampling + 0.5;
      }
      if (h_oversampling) {
        t += 2 * h_oversampling + 0.5;
      }
      return t;
    }

    function getMaxMeasureTime(t_oversampling, p_oversampling, h_oversampling) {
      let t = 1.25; // ms
      if (t_oversampling) {
        t += 2.3 * t_oversampling;
      }
      if (p_oversampling) {
        t += 2.3 * p_oversampling + 0.575;
      }
      if (h_oversampling) {
        t += 2.3 * h_oversampling + 0.575;
      }
      return t;
    }
  }

  RED.nodes.registerType("bme280", bme280);

}