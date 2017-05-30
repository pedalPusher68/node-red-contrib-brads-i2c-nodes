/**
 * Created by brad on 5/12/17.
 */

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
  // require any external libraries we may need....
  // Node.js Imports
  const os = require('os');
  // NPM Imports
  const i2c = require('i2c-bus');
  const BigNumber = require('bignumber.js');

  // Local Imports
  // const Measurement = require('./Measurement.js');

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

  // The main node definition - most things happen in here
  function bme280(config) {

    // Create a RED node
    RED.nodes.createNode(this, config);

    let BigNumber = require('bignumber.js');

    // copy "this" object in case we need it in context of callbacks of other functions.
    let node = this;

    node.log(JSON.stringify(config));

    node.debugMode = true;
    // Store local copies of the node configuration (as defined in the .html)
    // process config values and throw errors if necessary
    node.topic = config.topic;
    node.name = config.name;
    node.topic = config.topic;
    node.address = Number(config.address);
    if (node.debugMode) {
      node.log(`bme280 address:  0x${node.address.toString(16)}`);
    }
    node.powermode = Number(config.powermode);
    node.tresolution = Number(config.tresolution);
    node.t_oversampling = T_OVERSAMPLINGS.get(node.tresolution);
    if (node.t_oversampling === undefined) {
      throw(`Unable to process tresolution=${node.tresolution}`);
    } else {
      node.log(`node.t_oversampling -> ${JSON.stringify(node.t_oversampling)}`)
    }
    node.presolution = Number(config.presolution);
    node.p_oversampling = P_OVERSAMPLINGS.get(node.presolution);
    if (node.p_oversampling === undefined) {
      throw(`Unable to process presolution=${node.presolution}`);
    } else {
      node.log(`node.p_oversampling -> ${JSON.stringify(node.p_oversampling)}`)
    }

    BigNumber.config({DECIMAL_PLACES: 6});// TODO - base this on t_oversampling, then for P calcs, set based on p_oversampling

    node.ctrl_meas = node.tresolution + node.presolution + node.powermode;
    node.log(`ctrl_meas = ${node.ctrl_meas.toString(2)} (0x${node.ctrl_meas.toString(16)})`);

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

      // https://github.com/BoschSensortec/BME280_driver/blob/master/bme280.c
      // device is slow to power up so several attempts may be required to get the bme280 chip id (REGISTER_DEVICE_ID).
      try {
        node.deviceId = i2cBus.readByteSync(node.address, REGISTER_DEVICE_ID);
        resolve(`${node.name} Device ID:  0x${node.deviceId.toString(16)}  (expected 0x60)`);
      } catch (err) {
        node.error( err );
        // try one more time...
        try {
          node.deviceId = i2cBus.readByteSync(node.address, REGISTER_DEVICE_ID);
          node.ctrl_meas = i2cBus.readByteSync( node.address, REGISTER_CTRL_MEAS);
          let r = `${node.name} Device ID:  0x${node.deviceId.toString(16)}  (expected 0x60),\tREGISTER_CTRL_MEAS (0x${REGISTER_CTRL_MEAS.toString(16)}) -> 0b${node.ctrl_meas.toString(2)}`
          node.log( r );
          resolve(r);
        } catch (error) {
          err = error;
        }
        reject(`read REGISTER_DEVICE_ID (0x${REGISTER_DEVICE_ID.toString(16)}) error:  ${err}`);
      }
    });

    // get calibration parameters set 1 (1 of 2)
    let p2 = new Promise((resolve, reject) => {
      let buffer = new Uint8Array(12 * 2 + 1 /* 12 coefficients, 2 bytes each + 1 byte*/);
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
          node.digH1 = dataView.getUint8(i)
          node.haveCalibrationData1 = true;

          // node.log(node.name + '  JUST FOR FUN hexify(digP3, 8) -> '+ BaseSensor.hexify(node.digP3, 8, null) );

          i = 0x88;
          let r = os.EOL + 'bme280 calibration parameters loaded.' + os.EOL
            + 'Calibration Address:  0x' + i.toString(16) + (i + 1).toString(16) + printWord('   digT1', node.digT1) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + printWord('   digT2', node.digT2) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + printWord('   digT3', node.digT3) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + printWord('   digP1', node.digP1) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + printWord('   digP2', node.digP2) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + printWord('   digP3', node.digP3) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + printWord('   digP4', node.digP4) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + printWord('   digP5', node.digP5) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + printWord('   digP6', node.digP6) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + printWord('   digP7', node.digP7) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + printWord('   digP8', node.digP8) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + printWord('   digP9', node.digP9) + os.EOL;
          if (node.debugMode) {
            node.log(r);
          }
          resolve(r);
        }
      });
    });

    // get calibration parameters set 1 (1 of 2)
    let p3 = new Promise((resolve, reject) => {
      let buffer = new Uint8Array(3 * 2 + 2 /* 3 coefficients, 2 bytes each + 2 byte*/);
      i2cBus.readI2cBlock(node.address, CALIBRATION_PARAMS_ADDRESS2, buffer.length, buffer, (err, bytesRead, buffer) => {
        if (err) {
          let errResult = `${node.name} read calibration parameters error:  ${err}`;
          node.error(errResult);
          reject(errResult);
        } else {
          let dataView = new DataView(buffer.buffer);
          let i = 0;
          node.digH2 = dataView.getInt16(i, true);
          node.digH3 = dataView.getUint8(i += 2);
          node.digH4 = dataView.getInt16(i += 1, true);
          node.digH5 = dataView.getInt16(i += 2, true);
          node.digH6 = dataView.getUint8(i);
          node.haveCalibrationData2 = true;

          i = 0xe1;
          let r = os.EOL + 'bme280 calibration parameters loaded.' + os.EOL
            + 'Calibration Address:  0xa1' + printWord('   digH1', node.digH1) + os.EOL
            + 'Calibration Address:  0x' + (i).toString(16) + (i + 1).toString(16) + printWord('   digH2', node.digH2) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + printWord('   digH3', node.digH3) + os.EOL
            + 'Calibration Address:  0x' + (i += 1).toString(16) + (i + 1).toString(16) + printWord('   digH4', node.digH4) + os.EOL
            + 'Calibration Address:  0x' + (i += 2).toString(16) + (i + 1).toString(16) + printWord('   digH5', node.digH5) + os.EOL
            + 'Calibration Address:  0x' + (i).toString(16) + (i + 1).toString(16) + printWord('   digH6', node.digH6) + os.EOL;
          if (node.debugMode) {
            node.log(r);
          }
          resolve(r);
        }
      });
    });

    node.log("about to do Promise.all(...)");
    node.status({fill: "green", shape: "ring", text: "setting up bme280..."});
    Promise.all([p1, p2, p3]).then((resolve) => {
      node.haveCalibrationData = node.haveCalibrationData1 & node.haveCalibrationData2;
      node.ready = !!(node.haveCalibrationData && node.deviceId);
      node.status({fill: "green", shape: "dot", text: "bme280 ready"});
      if (node.debugMode) {
        node.log(`${node.name} ready.`);
      }
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
            let result = {
              device: "sensor",
              name: "bme280",
              temperature: node.temperature,
              temperatureF: node.temperatureF,
              t_oversampling: node.t_oversampling.display,
              pressure: node.pressure,
              p_oversampling: node.p_oversampling.display,
              pressureHg: node.pressure / 3386.39,
              timestamp: new Date()
            };

            let thingShadow = {
              state: {
                "reported": {
                  "device": "sensor",
                  "name": "bme280",
                  "temperature": node.temperatureF,
                  "temperatureUnits": "degrees Fahrenheit",
                  "pressureHg": node.pressure / 3386.39,
                  "timestamp": node.measurementDate
                }
              }
            };

            node.send([
              {topic: 'bme280', payload: result},
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
      node.log(JSON.stringify(msg));
      node.send(msg);
    });

    this.on("close", () => {
      // Called when the node is shutdown - eg on redeploy.
      // Allows ports to be closed, connections dropped etc.
      // eg: node.client.disconnect();
      node.log(`${node.name} received 'close' event.`);
    });
  }

  // Register the node by name. This must be called before overriding any of the
  // Node functions.
  RED.nodes.registerType("bme280", bme280);

  function printWord(label, value) {
    return `${label} -> 0x${value.toString(16)}     ${value}`;
  }

  function getTypicalMeasureTime( t_oversampling, p_oversampling, h_oversampling ) {
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

  function getMaxMeasureTime( t_oversampling, p_oversampling, h_oversampling ) {
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

  function measure(node) {
    let buffer = new Uint8Array(6);
    let command = (node.p_oversampling | node.t_oversampling | node.powermode) & 0xff;
    node.log(' measure() ...');

    return new Promise((resolve, reject) => {

      i2cBus.readByte( node.address, REGISTER_CTRL_MEAS, (err, byteRead) => {
        if (err) {
          let r = `${node.name} read REGISTER_CTRL_MEAS (0x${REGISTER_CTRL_MEAS.toString(16)}) error:  ${err},\t at device address 0x${node.address}`;
          node.error(r);
          reject( r );
        } else {
          let r = `${node.name} read REGISTER_CTRL_MEAS (0x${REGISTER_CTRL_MEAS}) byte -> 0b${byteRead.toString(2)}`;
        }
      });


      // TODO - read block of measured data bytes and process
      resolve( `sent commands...` );

    });
  }

}