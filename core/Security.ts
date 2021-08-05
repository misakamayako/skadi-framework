import * as fs from "fs";
import * as path from "path";
import { PathLike } from "fs";
import Dict = NodeJS.Dict;
import TypedArray = NodeJS.TypedArray;
import SessionCenter from "session-center";
import { IncomingMessage, ServerResponse } from "http";

export interface Content<session = undefined, body = undefined|any, query = undefined|any> extends IncomingMessage {
	originalUrl: string;
	session: session;
	removeSession: (req: IncomingMessage, res: ServerResponse) => void;
	query: query;
	body: body;
	params?: string;
}

export enum ServerType {
	"Publicnet",
	"Intranet",
	"Native",
}

export default class Security<SessionContent> {
	/**
	 * control if you allow you site display in frame,
	 * value should be like, "DENY", "SAMEORIGIN" or "ALLOW-FROM https://example.com/"
	 */
	XFrameOptions?: "DENY" | "SAMEORIGIN" | string;
	/**
	 * if your app is behind a proxy with sets a header to specify secure connections,
	 * and that proxy ensures that user-submitted headers with the same name are ignored (so that people can't spoof it),
	 * set this value to a tuple of (header_name, header_value). For any requests that come in with that header/value,
	 * request.is_secure() will return true.
	 * WARNING! Only set this if you fully understand what you're doing.
	 * Otherwise, you may be opening yourself up to a security risk.
	 */
	SecureProxySSLHeader: Dict<string> = {};

	/**
	 * weather to use tls(https link), if set as true, tls' file or pfx file's path block must be gaven
	 */
	tls = false;
	tlsKey?: PathLike;
	tlsCert?: PathLike;
	pfx?: PathLike;
	passphrase?: string;

	tlsConfig?: { key: Buffer; cert: Buffer } | { pfx: Buffer; passphrase: string };

	/**
	 * use cookie to store sign instead of JWT
	 */
	cacheSession: boolean | null = true;
	sessionName = "SessionId";
	maxAge?: number = 2 * 3600;
	domain?: string;
	secure = true;
	path?: string;
	useExpires = true;
	httpOnly = true;
	sameSite?: boolean | "lax" | "strict" | "none" = "lax";
	salt?: string | Buffer | TypedArray | DataView;
	idKey?: string; //keyof SessionContent;
	singleClient?: boolean;
	port = 80;
	TrustOrigins?: Array<string>;
	ServerType: ServerType = ServerType.Publicnet;

	// @ts-ignore
	private getSession: (req: IncomingMessage | string, res?: ServerResponse) => false | SessionContent;
	// @ts-ignore
	private setSession: (sessionContent: SessionContent, req?: IncomingMessage, res?: ServerResponse) => string;
	// @ts-ignore
	private removeSession: (req: IncomingMessage, res: ServerResponse) => void;

	init() {
		if (this.tls) {
			if (!(this.tlsCert && this.tlsKey) && !(this.pfx && this.passphrase)) {
				this.tlsError();
			}
			try {
				if (this.tlsCert && this.tlsKey) {
					this.tlsConfig = {
						key: fs.readFileSync(this.tlsKey),
						cert: fs.readFileSync(this.tlsCert),
					};
				} else {
					this.tlsConfig = {
						pfx: fs.readFileSync(<PathLike>this.pfx),
						passphrase: <string>this.passphrase,
					};
				}
			} catch (E) {
				this.tlsError();
			}
		}
		if (this.cacheSession) {
			if (!this.tlsConfig) {
				console.warn("secure is useless when tls is off, and secure has been set to false");
				this.secure = false;
			}
			const config = {
				name: this.sessionName,
				maxAge: this.maxAge,
				domain: this.domain,
				secure: this.secure,
				path: this.path,
				useExpires: this.useExpires,
				httpOnly: this.httpOnly,
				sameSite: this.sameSite,
				secretSalt: this.salt,
				idKey: this.idKey,
				singlePoint: this.singleClient,
			};
			const sessionCenter = new SessionCenter<SessionContent>(config);
			this.getSession = sessionCenter.getSession.bind(sessionCenter);
			this.setSession = sessionCenter.setSession.bind(sessionCenter);
			this.removeSession = sessionCenter.removeSession.bind(sessionCenter);
		} else if (typeof this.cacheSession === "boolean") {
			this.getSession = () => false;
			this.setSession = () => "";
			this.removeSession = () => void 0;
		} else {
			// todo: JWT
			this.getSession = () => false;
			this.setSession = () => "";
			this.removeSession = () => void 0;
		}
	}

	tlsError() {
		if (process.env.NODE_ENV !== "production") {
			console.error(
				"you have set tls to true, but cert or pfx files are not correct, server will use default cert in dev mode",
			);
			console.error("please confirm that your file will be correct in production mode");
			this.tlsKey = path.join(__dirname, "../asset/cert/skey.pem");
			this.tlsCert = path.join(__dirname, "../asset/cert/server.pem");
		} else {
			console.error(
				new Error("Your cert or pfx file is not correct, and server won't start in production mode in case of security"),
			);
			process.exit(1);
		}
	}

	getContent(req: IncomingMessage, res: ServerResponse) {
		// const content = this.getSession(req, res);
		const t = req as Content<SessionContent>;
		// t.session = content || undefined;
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const sessionCenter = this;
		Object.defineProperty(t, "session", {
			get() {
				return sessionCenter.getSession(req, res);
			},
			set(value) {
				sessionCenter.setSession(value, t, res);
			},
		});
	}

	handle() {
		return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
			this.getContent(req, res);
			next();
		};
	}
}
