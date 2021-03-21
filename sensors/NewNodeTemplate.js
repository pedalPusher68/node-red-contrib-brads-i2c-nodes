// Not used other than to serve as a reference for the structure of a node (Node RED 1.2.9)
// https://nodered.org/docs/creating-nodes/

module.exports = function (RED) {

    function SomeNode(config) {

        RED.nodes.createNode(this, config);

        const node = this;

        node.on('input', function (msg, send, done) {
            msg.payload = msg.payload.toLowerCase();

            // For maximum backwards compatibility, check that send exists.
            // If this node is installed in Node-RED 0.x, it will need to
            // fallback to using `node.send`
            send = send || function () {
                node.send.apply(node, arguments)
            }
            send(msg);

            if (done) {
                done();
            }
        });

        function deviceConfig(node, config) {
        }

        function deviceMeasure(node, send) {

        }

        function deviceClose(node, removed, done) {

        }

        function someOtherFunction1() {

        }

        function someOtherFunction2() {

        }
    }

    RED.nodes.registerType("some-node", SomeNode);
}