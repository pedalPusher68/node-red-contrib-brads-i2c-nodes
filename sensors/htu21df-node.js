/**
 * Created by brad on 4/8/17.
 */

/**
 * Copyright Bradley Smith - bradley.1.smith@gmail.com
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
  // NPM Imports
  const i2c = require('i2c-bus');
  let BigNumber = require('bignumber.js');
  BigNumber.config({DECIMAL_PLACES: 4});

  // Local Imports
  // const Measurement = require('./Measurement.js');

  const HTU21DFAddress = 0x40;

  const commandMeasureTemperatureHoldMaster = 0xE3;
  const commandMeasureHumidityHoldMaster = 0xE5;
  const commandMeasureTemperatureNoHoldMaster = 0xF3;
  const commandMeasureHumidityNoHoldMaster = 0xF5;
  const commandWriteUserRegister = 0xE6;
  const commandReadUserRegister = 0xE7;
  const commandSoftReset = 0xFE;

  const waitTimeTemperature14BIT = 50;//ms (factory default)
  const waitTimeTemperature13BIT = 25;//ms
  const waitTimeTemperature12BIT = 13;//ms
  const waitTimeTemperature11BIT = 7;//ms

  const waitTimeRH12BIT = 16;//ms (factory default)
  const waitTimeRH11BIT = 8;//ms
  const waitTimeRH10BIT = 5;//ms
  const waitTimeRH8BIT = 3;//ms


  const A = new BigNumber('8.1332');
  const B = new BigNumber('1763.39');
  const C = new BigNumber('235.66');

  const dateFormatOptions = {
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false, timeZone: 'America/New_York'
  };

  let i2cBus = undefined;

  function computeDewpoint(temp, rh, node) {
    let exponent = A.minus(B.div(C.plus(temp))).toNumber();
    node.log(`exponent -> ${exponent}`);
    let pp = Math.pow(10, exponent);
    node.log(`pp -> ${pp}`);
    let log10Operand = pp * rh / 100.0;
    node.log(`log10Operand -> ${log10Operand}`);
    let TDP = -1 * ( C.toNumber() + (B.toNumber() / (Math.log10(log10Operand) - A.toNumber())));
    node.log(`Dew Point Temperature -> ${TDP}`);
    let TDPStr = TDP.toString();
    if (TDPStr.length > 10) {
      TDP = Number( TDPStr.substr(0, 9));
      node.log(`(chopped) Dew Point Temperature -> ${TDP}`);
    }
    return TDP;
  }


  // The main node definition - most things happen in here
  function htu21df(config) {

    // Create a RED node
    RED.nodes.createNode(this, config);

    // copy "this" object in case we need it in context of callbacks of other functions.
    let node = this;

    node.log(JSON.stringify(config));
    if (i2cBus == undefined) {
      i2cBus = i2c.openSync(1);
      node.log("opened i2cBus -> " + i2cBus);
    }
    node.log("starting up htu21df");

    node.address = HTU21DFAddress;
    node.temperature = -9999;
    node.relativeHumidity = -9999;
    node.dewPoint = -9999;

    // Store local copies of the node configuration (as defined in the .html)
    // this.topic = config.topic;

    // respond to inputs....
    this.on('input', (msg) => {

      let command = msg.payload; // One of:  measure, set_config, get_config, ... TODO - add other input types support
      if (command) {
        if ("measure" == command) {
          // TODO - dynamically set desired resolution before measuring...

          // TODO - for now, just measure at device defaults
          let tempBuffer = new Uint8Array(2);
          let humidityBuffer = new Uint8Array(2);

          let now = Date.now();

          measure(node).then((resolve) => {
            let result = {
              device:"sensor",
              name: "htu21df",
              temperatureC: node.temperature,
              temperatureCString: node.temperature + " \u2103",
              temperatureF: node.temperature.toNumber()*1.8 + 32,
              relativeHumidity: node.relativeHumidity,
              relativeHumidityString: node.relativeHumidity + " %",
              dewPointC: node.dewPoint,
              dewPointCString: node.dewPoint + " \u2103",
              timestamp: new Date()
            };

            let thingShadow = {
              state: {
                "reported": {
                  "device": "sensor",
                  "name": "htu21df",
                  "temperature": node.temperature.times(1.8).add(32.0).toNumber(),
                  "temperatureUnits": "degrees Fahrenheit",
                  "relativeHumidity": node.relativeHumidity.toNumber(),
                  "dewPoint": new BigNumber(node.dewPoint).times(1.8).add(32.0).toNumber(),
                  "timestamp": node.measurementDate
                }
              }
            };

            node.send([
              {topic: 'htu21df', payload: result},
              {topic: 'htu21df', payload: thingShadow}
            ]);

          }, (reject) => {
            msg.payload = `${reject}`;
            node.send(msg);
          });

        }
      }
    });

    this.on("close", () => {
      node.log("close");
      // Called when the node is shutdown - eg on redeploy.
      // Allows ports to be closed, connections dropped etc.
      // eg: node.client.disconnect();
    });
  }

  // Register the node by name. This must be called before overriding any of the
  // Node functions.
  RED.nodes.registerType("htu21df", htu21df);

  function measure(node) {
    return new Promise( ( resolve, reject ) => {
      let tempBuffer = new Uint8Array(2);
      let humidityBuffer = new Uint8Array(2);

      i2cBus.sendByte(node.address, commandMeasureTemperatureNoHoldMaster, (err) => {
        if (err) {
          let errMsg = `send read temperature command error:  ${err}`;
          node.error(errMsg);
          reject( errMsg );
        } else {
          setTimeout( () => {
            i2cBus.i2cRead(node.address, tempBuffer.length, tempBuffer, (err, bytesRead, buffer) => {
              if (err) {
                let errMsg = `read temperature value error:  ${err}`;
                node.error(errMsg);
                reject(errMsg);
              } else {
                let dataView = new DataView(buffer.buffer);
                node.temperature = new BigNumber(dataView.getUint16(0), 10).div(65536).times('175.72').minus('46.85');
                // this.temperature = -46.85 + 175.72 * (dataView.getUint16(0) / 65536);
                node.log(`Temperature:  ${node.temperature} \u2103`);
                // measure relative humidity
                i2cBus.sendByte(node.address, commandMeasureHumidityNoHoldMaster, (err) => {
                  if (err) {
                    let errMsg = `send measure humidity command error:  ${err}`;
                    node.error(errMsg);
                    reject( errMsg );
                  } else {
                    setTimeout( () => {
                      i2cBus.i2cRead(node.address, humidityBuffer.length, humidityBuffer, (err, bytesRead, buffer) => {
                        if (err) {
                          let errMsg = `read humidity value error:  ${err}`;
                          node.error(errMsg );
                          reject( errMsg );
                        } else {
                          node.measurementDate = new Date().toLocaleString('en-US', dateFormatOptions);
                          let dataView = new DataView(buffer.buffer);
                          node.relativeHumidity = new BigNumber(dataView.getUint16(0)).div(65536).times(125).minus(6);
                          // this.relativeHumidity = -6.0 + 125 * (dataView.getUint16(0) / 65536);
                          node.log(`HTU21DF RH:  ${node.relativeHumidity} %`);
                          node.dewPoint = computeDewpoint(node.temperature, node.relativeHumidity, node);
                          // node.log("HTU21DF Dew point:  " + DP + ' \u2103');
                          resolve( [node.temperature, node.relativeHumidity, node.dewPoint] );
                        }
                      });
                    }, waitTimeRH12BIT);
                  }
                });
              }
            });
          }, waitTimeTemperature14BIT /* ms */);
        }
      });
    });
  }


}