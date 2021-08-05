import { Content } from "../core/Security";
import { ServerResponse } from "http";
import { NoParamCallback } from "fs";
import { HttpResponseNotAllowed, HttpResponseServerError } from "../modal/response";
import { NextHandleFunction } from "connect";

export const Service: ClassDecorator = function (target) {
	target.prototype.requestHandle = function (content: Content, res: ServerResponse, next: NoParamCallback) {
		const requestMethod = (content.method as string).toLowerCase();
		const requestMap: Map<string, NextHandleFunction> = target.prototype["requestMap"];
		if (!requestMap.has(requestMethod)) {
			new HttpResponseNotAllowed(res).end();
			next(new Error("method not allowed"));
		} else {
			const method = requestMap.get(requestMethod);
			if (!method) {
				new HttpResponseServerError(res, "mutable implement of current request").end();
				next(new Error("mutable implement of current request"));
			} else {
				try {
					method(content, res, (err: Error | null) => {
						next(err);
					});
				} catch (e) {
					console.error(e);
					new HttpResponseServerError(res, e.message).end();
					next(e);
				}
			}
		}
	};
};
