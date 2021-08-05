import dayjs from "dayjs";

import Dict = NodeJS.Dict;
import { OutgoingHttpHeader, ServerResponse } from "http";
import cookie, { CookieSerializeOptions, serialize } from "cookie";
import { PathLike } from "fs";
import * as fs from "fs";
import mime from "mime-types";
import { Content } from "../../core/Security";
import { URL } from "url";

export class HttpResponseBase {
	protected readonly headers: Dict<OutgoingHttpHeader>;
	private cookies: Map<string, { value: any; config?: CookieSerializeOptions }> = new Map();
	closed = false;
	status = 200;
	readonly flush;
	reasonPhrase?: string;
	defaultCookieOption: CookieSerializeOptions = {};
	actual?: HttpResponseBase;

	closeConnect: () => void = () => {
		console.log("can't close current connection");
	};

	readonly response: ServerResponse;

	constructor(response: ServerResponse) {
		this.headers = response.getHeaders();
		this.flush = response.flushHeaders;
		this.response = response;
		if (response.socket) {
			this.closeConnect = response.socket.end;
		}
	}

	addHeader(head: string, value: OutgoingHttpHeader) {
		head = head.toLowerCase();
		const oldValue = this.headers[head];
		if (oldValue === undefined) {
			this.headers[head] = value;
		} else {
			if (!Array.isArray(value)) {
				value = [value.toString()];
			}
			if (!Array.isArray(oldValue)) {
				value.push(oldValue.toString());
				this.headers[head] = value;
			} else {
				this.headers[head] = [...oldValue, ...value];
			}
		}
		return this;
	}

	setHeader(head: string, value: OutgoingHttpHeader) {
		if (this.getHeader(head)) {
			this.deleteHeader(head);
		}
		this.addHeader(head, value);
		return this;
	}

	deleteHeader(head: string, value?: string) {
		head = head.toLowerCase();
		const header = this.headers[head];
		if (value === undefined) {
			delete this.headers[head];
		} else {
			if (header) {
				if (Array.isArray(header)) {
					const index = header.indexOf(value);
					header.splice(index, 1);
					if (header.length === 0) {
						delete this.headers[head];
					}
				} else if (header === value) {
					delete this.headers[head];
				}
			}
		}
		return this;
	}

	getHeader(head: string) {
		return this.headers[head.toLowerCase()];
	}

	setCookie(cookieProps: { key: string; value: any; config?: CookieSerializeOptions }) {
		const config = cookieProps.config || this.defaultCookieOption;
		// eslint-disable-next-line prefer-const
		let { maxAge, expires, path = "/", domain, secure = true, httpOnly = false, sameSite } = config;
		if (expires !== undefined) {
			if (!dayjs(expires).isValid()) {
				throw Error(`expires:${expires} is not a valid date`);
			}
			const delta = expires.getUTCDate() - Date.now();
			maxAge = Math.max(0, Math.floor(delta / 1000));
		} else {
			expires = undefined;
		}
		if (maxAge !== undefined) {
			if (!expires) {
				expires = new Date(Date.now() + maxAge);
			}
		}
		if (sameSite) {
			if (sameSite === true) {
				sameSite = "lax";
			}
			if (!["lax", "none", "strict"].includes(sameSite.toLowerCase())) {
				throw new TypeError("sameSite must be one of 'lax', 'none', or 'strict'.");
			}
		}
		this.cookies.set(cookieProps.key, {
			value: cookieProps.value,
			config: { maxAge, expires, path, domain, secure, httpOnly, sameSite },
		});
		return this;
	}

	deleteCookie(key: string, path = "/", domain?: string, sameSite?: boolean | "none" | "lax" | "strict" | undefined) {
		const secure = Boolean(
			/^(__Secure|__Host)/.test(key) || sameSite === true || (sameSite && sameSite.toLowerCase() !== "none")
		);
		this.setCookie({ key, value: "", config: { maxAge: 0, expires: new Date(0), path, domain, secure, sameSite } });
		return this;
	}

	setStatus(statusCode: number) {
		this.status = statusCode;
		return this;
	}

	end() {
		if (this.closed) {
			console.error("this connection has been closed and no more editable");
		} else {
			if (this.actual) {
				this.actual.end();
				return;
			}
			this.closed = true;
			const contentType = this.getHeader("content-type");
			if (!contentType) {
				this.addHeader("content-type", "text/html;charset=UTF-8");
			}
			for (const headersKey in this.headers) {
				if (Array.isArray(this.headers[headersKey])) {
					// @ts-ignore
					this.response.setHeader(headersKey, this.headers[headersKey].join(";"));
				} else {
					// @ts-ignore
					this.response.setHeader(headersKey, this.headers[headersKey]);
				}
			}
			this.cookies.forEach((value, key) => {
				this.response.setHeader("set-cookie", cookie.serialize(key, value.value, value.config));
			});
			this.response.statusCode = this.status;
		}
	}
}

export class HttpResponse extends HttpResponseBase {
	protected content: Buffer;

	constructor(response: ServerResponse, content?: string | Buffer) {
		super(response);
		if (content instanceof Buffer) {
			this.content = content;
		} else {
			this.content = Buffer.from(content || "");
		}
	}

	writeable = true;

	write(content: string | Buffer) {
		if (this.closed) {
			console.error("current connection has been closed.");
		}
		if (this.writeable) {
			if (typeof content === "string") {
				this.content = Buffer.concat([this.content, Buffer.from(content)]);
			} else {
				this.content = Buffer.concat([this.content, content]);
			}
		} else {
			console.warn("current connection is not writeable.");
		}
		return this;
	}

	readable = true;

	read() {
		return this.content.toString();
	}

	end() {
		if (this.closed || this.response.writableEnded) {
			return;
		}
		super.end();
		this.addHeader("Content-Length", this.content.length.toString());
		this.response.write(this.content);
	}
}

export class StreamingHttpResponse extends HttpResponseBase {
	protected streaming = true;
	protected stream?: NodeJS.ReadableStream;
	protected streamStatus = "wait";

	constructor(response: ServerResponse, stream?: NodeJS.ReadableStream) {
		super(response);
		if (stream) {
			this.streamContent = stream;
		}
		this.setHeader("content-type", "application/octet-stream")
			.setHeader("Transfer-Encoding", "chunked")
			.setHeader("Accept-Ranges", "bytes");
	}

	get streamContent() {
		return this.stream;
	}

	set streamContent(value) {
		if (this.closed) {
			console.error("this connection has been closed, and no more editable");
			return;
		}
		if (value) {
			value.pause();
			this.stream = value;
			this.streamStatus = "wait";
		}
	}

	end() {
		if (!this.closed) {
			super.end();
			if (this.stream) {
				this.stream.pipe(this.response);
				this.stream.resume();
				const timer = setInterval(() => {
					this.flush();
				}, 5000);
				this.streamStatus = "processing";
				this.stream.on("end", () => {
					this.response.end();
					this.streamStatus = "end";
					clearInterval(timer);
				});
				this.stream.on("error", (error) => {
					clearInterval(timer);
					this.streamStatus = "error";
					console.error(error);
				});
			} else {
				if (this.streaming) {
					this.actual = new HttpResponseServerError(this.response, "stream instance error");
					this.actual.end();
				}
			}
		} else {
			console.error("current connection has been closed");
		}
	}
}

export class HttpStreamFileResponse extends StreamingHttpResponse {
	filename?: string;
	asAttachment?: boolean;
	encode?: string;
	protected exists = true;
	protected filePath?: PathLike;

	constructor(
		response: ServerResponse,
		filePath?: PathLike,
		asAttachment = false,
		encode = "UTF-8",
		filename?: string
	) {
		super(response);
		this.deleteHeader("content-type");
		if (filePath && fs.existsSync(filePath)) {
			this.filePath = filePath;
			this.asAttachment = asAttachment;
			this.encode = encode;
			this.filename = filename;
		} else {
			this.exists = false;
		}
	}

	private setHeaders(filePath: PathLike) {
		if (!this.getHeader("content-type")) {
			const contentType = mime.contentType(this.filename || filePath.toString());
			if (contentType) {
				this.setHeader("content-Type", contentType);
			} else {
				this.setHeader("content-Type", "text/plain");
			}
		}
	}

	setFile(filePath?: PathLike, asAttachment = false, encode = "UTF-8", filename?: string) {
		if (filePath && fs.existsSync(filePath)) {
			this.exists = true;
			this.filePath = filePath;
			this.asAttachment = asAttachment;
			this.encode = encode;
			this.filename = filename;
		} else {
			this.exists = false;
		}
		return this;
	}

	setAsAttachment(type: boolean) {
		this.asAttachment = type;
		return this;
	}

	end() {
		this.deleteHeader("Content-Disposition");
		if (this.exists) {
			if (this.filename) {
				this.addHeader("Content-Disposition", `filename="${this.filename}"`);
			}
			if (this.asAttachment) {
				this.addHeader("Content-Disposition", "attachment");
			} else {
				this.addHeader("Content-Disposition", "inline");
			}
			this.setHeaders(this.filePath as string);
			if (this.streaming) {
				this.stream = fs.createReadStream(this.filePath as string, this.encode);
				this.stream.pause();
			}
		} else {
			this.actual = new Http404(this.response, `cannot find file you looking for in  '${this.response.req.url}'`);
		}
		super.end();
	}
}

export class HttpSyncFileResponse extends HttpStreamFileResponse {
	streaming = false;
	content?: Buffer;

	constructor(
		response: ServerResponse,
		filePath?: PathLike,
		asAttachment = false,
		encode = "UTF-8",
		filename?: string
	) {
		super(response, filePath, asAttachment, encode, filename);
		this.deleteHeader("content-type", "application/octet-stream")
			.deleteHeader("Transfer-Encoding", "chunked")
			.deleteHeader("Accept-Ranges", "bytes");
	}

	end() {
		super.end();
		if (this.exists && this.filePath) {
			this.content = fs.readFileSync(this.filePath);
			this.setHeader("content-length", this.content.length);
		}
		this.response.write(this.content);
	}
}

export class HttpResponseRedirectBase extends HttpResponse {
	status = 301;

	constructor(response: ServerResponse, content: Content<any,any,any>, redirectTo: string) {
		super(response);
		if (content.originalUrl) {
			const current = new URL(content.originalUrl);
			const nextURL = new URL(redirectTo,current);
			if (nextURL.protocol === current.protocol && nextURL.host === current.host) {
				this.addHeader("Location", nextURL.toString());
			} else {
				this.actual = new HttpResponseServerError(
					response,
					`Unsafe redirect from ${content.originalUrl} to ${redirectTo}`
				);
			}
		}
	}

	end() {
		super.end();
	}
}

export class HttpResponseRedirect extends HttpResponseRedirectBase {
	status = 302;
}

export class HttpResponsePermanentRedirect extends HttpResponseRedirectBase {
	status = 301;
}

export class HttpResponseBadRequest extends HttpResponse {
	status = 400;
}
export class HttpResponseUnauthorized extends HttpResponse {
	status = 401;
}

export class HttpResponseForbidden extends HttpResponse {
	status = 403;
}

export class HttpResponseNotFound extends HttpResponse {
	status = 404;
}

export class HttpResponseNotAllowed extends HttpResponseBase {
	status = 405;

	constructor(response: ServerResponse, permittedMethods?: string[] | string) {
		super(response);
		if (permittedMethods) {
			this.addHeader("Allow", permittedMethods);
		}
	}
}

export class HttpResponseGone extends HttpResponse {
	status = 410;
}

export class Http404 extends HttpResponse {
	status = 404;
}

export class HttpResponseServerError extends HttpResponse {
	status = 500;
}

export class JsonResponse extends HttpResponse {
	constructor(response: ServerResponse, data: Dict<any>) {
		super(response, JSON.stringify(data));
		this.addHeader("Content-Type", "application/json");
	}
}
