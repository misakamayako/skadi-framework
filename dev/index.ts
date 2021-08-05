import SkadiFramework, { Security } from "..";
import route from "./router";
import helmet = require("helmet");
import bodyParser from "body-parser";
import Dict = NodeJS.Dict;
import { ServerType } from "../core/Security";

class MySecurity extends Security<Dict<any>> {
	tls = true;
	SecureProxySSLHeader: NodeJS.Dict<string> = {};
	ServerType = ServerType.Native
	port = 443;
}
const d = new MySecurity();
d.init();
const app = new SkadiFramework(d);
app.use(helmet());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.route(route);
app.start((error) => {
	if (error) {
		console.log(error);
	} else {
		console.log("success");
	}
});
