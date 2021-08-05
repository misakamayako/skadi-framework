import * as os from "os";
import http, { ServerResponse } from "http";
import https from "https";
import Security, { Content, ServerType } from "./Security";
import { HttpResponseServerError } from "../modal/response";
import { NoParamCallback, PathLike } from "fs";
// @ts-ignore
import originUrl from "original-url";
import Router from "../Router";

type SkadiPlugin = (req: Content, res: ServerResponse, next: () => void) => void;

type Config = {
	trailingSlash: boolean;
	fileUploadMaxSize: number;
	dataUploadMaxSize: number;
	dataUploadMaxFieldsNumber: number;
	fileUploadTempDir: PathLike;
	maxHeadersCount: number;
	uploadLocale: PathLike;
};

export default class Skadi {
	/** whether server is in debug mode,
	 * if set ture, some request will receive full error report instate of code,
	 * and some other setting is different
	 */
	debug: boolean = process.env.NODE_ENV !== "production";
	/**
	 * access control
	 */
	// accessControl?: AccessControl;
	/**
	 * the server's timezone, but is not effective current
	 */
	timezone = "";
	/**
	 * data base config, not required
	 */
	// database?: SkadiTypes.DataBase; todo
	/**
	 * should server always add a '/' to the end of the url
	 */
	trailingSlash = true;
	/**
	 * security setting, if not gaven, server will use default setting
	 */
	security: Security<unknown>;

	/**
	 * max size of file can be uploaded, default is 2^18*10, which is 25mib
	 */
	fileUploadMaxSize = 2621440;
	/**
	 * max size of request body, default is 2^18*10, which is 25mib
	 */
	dataUploadMaxSize = 2621440;
	/**
	 * max fields of request body, default is 1000
	 */
	dataUploadMaxFieldsNumber = 1000;
	/**
	 * temp dir of uploaded file,default is os's temp dir,which is /tmp in *nix, and c:\User\%user%\AppData\Local\Temp.
	 */
	fileUploadTempDir: PathLike = os.tmpdir();
	/**
	 * max headers count of request, default is 1000
	 */
	maxHeadersCount = 1000;
	uploadLocale?: string | Array<((fileType: string) => string) | string>;
	staticRouter?: string | Array<((fileType: string) => string) | string>;
	server?: http.Server | https.Server;
	static Router = Router;
	constructor(security: Security<any>, config?: Config) {
		this.security = security;
		this.use(security.handle());
		this.use((req, res, next) => {
			req.originalUrl = originUrl(req).full;
			next();
		});
	}

	start(callback: NoParamCallback = () => void 0) {
		const security = this.security;
		const serverType = security.tls ? https : http;
		if (security.port === undefined) {
			security.port = security.tls ? 443 : 80;
		} else if (typeof security.port !== "number") {
			callback(TypeError("security.port must be a number in 0~65555"));
			return;
		} else if (security.port < 0 || security.port > 65555) {
			callback(RangeError("security.port must be in range of 0 to 65555"));
			return;
		}
		const server = serverType.createServer(
			{
				...security.tlsConfig,
				maxHeaderSize: this.maxHeadersCount,
			},
			(req, res) => {
				try {
					this.handle(req as Content<any>, res, (err: Error | null) => {
						if (err) {
							new HttpResponseServerError(res, err.message).end();
							res.end();
							console.log(err);
							return;
						}
						if (this.router) {
							this.router.handle(req as Content<unknown>, res, (err) => {
								if (err) {
									// customErrorHandle(req,res,err,next)
									res.end();
								} else if (!res.writableEnded) {
									res.end();
								}
							});
						} else {
							throw new Error("server error");
						}
					});
				} catch (e) {
					new HttpResponseServerError(res, e.message).end();
					console.log(e);
					console.trace();
				}
			}
		);
		const host = security.ServerType !== ServerType.Publicnet ? "127.0.0.1" : "0.0.0.0";
		server.on("listening", () => {
			console.log(`server start success at ${security.tls ? "https" : "http"}://${host}:${security.port}`);
			callback(null);
		});
		server.on("clientError", (err, socket) => {
			if (err.code === "ECONNRESET" || !socket.writable) {
				return;
			}
			socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
		});
		server.on("error", (error) => {
			if (error.code === "EADDRINUSE") {
				callback(Error(`port: ${security.port} is already in use`));
			} else {
				callback(error);
			}
		});
		this.server = server;
		server.listen(security.port, host);
		return this;
	}

	private plugins: SkadiPlugin[] = [];

	use(plugin: SkadiPlugin) {
		this.plugins.push(plugin);
	}

	private router?: Router;

	route(router: Router) {
		this.router = router;
	}

	private async handle(content: Content, res: ServerResponse, next: NoParamCallback) {
		for (const i in this.plugins) {
			try {
				await new Promise<void>((resolve, reject) => {
					this.plugins[i](content, res, (error?: any) => {
						if (error) {
							throw new Error(`server error while parsing plugin ${this.plugins[i].name}`);
						}
						resolve();
					});
				});
			} catch (e) {
				next(e);
				return;
			}
		}
		next(null);
	}

	static(path: PathLike) {}
}
