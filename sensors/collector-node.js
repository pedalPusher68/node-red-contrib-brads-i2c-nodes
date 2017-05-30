/**
 * Created by brad on 4/19/17.
 */
/**
 * Copyright brad 2017
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

// If you use this as a template, update the copyright with your own name.

// Sample Node-RED node file


module.exports = function (RED) {
  "use strict";
  // require any external libraries we may need....
  //var foo = require("foo-library");

  // The main node definition - most things happen in here
  function collector(config) {

    // Create a RED node
    RED.nodes.createNode(this, config);

    // Store local copies of the node configuration (as defined in the .html)
    this.topic = config.topic;

    // copy "this" object in case we need it in context of callbacks of other functions.
    let node = this;
    node.log(JSON.stringify(config));

    node.name = (config.name) ? config.name : 'collector';

    node.sensorCount = getSensorCount(config.sensorCount);
    node.log(`sensorCount -> ${node.sensorCount}`);
    if (node.sensorCount < 1) {
      node.status({fill: "red", shape: "ring", text: `${node.name} sensorCount must be a number greater than 1 - check configuration.`});
    } else {
      node.status({fill: "green", shape: "dot", text: `sensor count = ${node.sensorCount}`});
    }

    node.devices = [];

    /*
     state: {
     "reported": {
     "device": "sensor",
     "name": "mcp9808",
     "temperature": node.temperatureF,
     "temperatureUnits": "degrees Fahrenheit",
     "deviceResolution": node.resolution.displayF,
     "timestamp": node.measurementDate
     }
     }
     */

    // respond to inputs....
    node.on('input', (msg) => {
      node.log(`collector received input:  msg -> ${JSON.stringify( msg )}`);

      if ('state' in msg.payload && 'reported' in msg.payload['state']) {
        let reported = msg.payload['state']['reported'];
        node.log(`collector:  reported -> ${reported}`);
        if ('device' in reported) {
          node.devices.push( reported );
          node.log( `reported[device] -> ${JSON.stringify( reported )}`);
        }
      }
      node.log(`devices[${node.devices.length}], sensorCount -> ${node.sensorCount}`);
      if (node.devices.length == node.sensorCount) {
        node.log(`node.devices -> ${JSON.stringify( node.devices )}`);
        let devicesCopy = Array.from( node.devices );
        node.log(`devicesCopy -> ${JSON.stringify(devicesCopy)}`);
        let msg = {
          topic:'collector',
          payload: {
            "state": {
              "reported": {
                "devices": Array.from( node.devices )
              }
            }
          }
        };
        node.send(msg);
        node.devices = [];
      }
    });

    node.on("close", function () {
      // Called when the node is shutdown - eg on redeploy.
      // Allows ports to be closed, connections dropped etc.
      // eg: node.client.disconnect();
    });
  }

  // Register the node by name. This must be called before overriding any of the
  // Node functions.
  RED.nodes.registerType("collector", collector);


  function getSensorCount(value) {
    let c = -1;
    if (value) {
      if (typeof value != "number") {
        try {
          c = Number(value);
        } catch(err) {
          node.error(err);
        }
      }
    }
    return c;
  }
}