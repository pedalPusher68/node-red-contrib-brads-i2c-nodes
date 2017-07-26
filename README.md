# node-red-i2c-nodes
A collection of node-red nodes for assorted i2c devices

All nodes use an [ inject ] node to send a string command of 'measure' to initiate sensor measurement based on values set in the config panels of the flow diagram.

Outputs:

#1 - measured and derived and calculated values from the sensor

#2 - same as #1 but organized as AWS 'Thing State' for transmission to an AWS IOT MQTT broker.
