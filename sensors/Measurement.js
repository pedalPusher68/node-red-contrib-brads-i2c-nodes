/**
 * Created by brad on 2/25/17.
 */
'use strict';

exports.Unit = class Unit {
  constructor(display, name) {
    this.display = display;
    this.name = name;
  }
};

const Unit = exports.Unit;

exports.Units = new Map();

const u = exports.Units;
u.set('C', new Unit('\u2103', 'Celsius'));
u.set('F', new Unit('\u2109', 'Fahrenheit'));
u.set('K', new Unit('\u212A', 'Kelvin'));
u.set('Pa', new Unit('Pa', 'Pascals'));
u.set('InchesHg', new Unit('inches Hg', 'Inches of Mercury'));
u.set('RH', new Unit('%RH', '% Relative Humidity'));
u.set('Lux', new Unit('Lux', 'Lux'));
u.set('Unknown', new Unit('', 'Raw Number'));

exports.Measurement = class Measurement {

  constructor(sensorName, value, unit, type, timestamp, resolution) {
    this.sensorName = sensorName;
    this.value = value;
    this.unit = unit;
    this.type = type;
    this.timestamp = timestamp;
    this.resolution = (resolution) ? resolution : null;
  }
};

exports.SensorHost = class SensorHost {
  constructor( name, serialId ) {
    this.name = name;
    this.serialId = serialId;
    this.description = '';
    this.location = '';
    this.networkAddress = [];
    console.log('new SensorHost');
  }
}

exports.MeasurementMaster = class MeasurementMaster {
  constructor(sensorHost) {
    this.sensorHost = sensorHost;
    this.timestamp = new Date();
    this.cpuTemperature = null;
    this.sensorMeasurements = [];
  }

}