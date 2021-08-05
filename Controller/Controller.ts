import { Content } from "../core/Security";
import { ServerResponse } from "http";
import { NoParamCallback, PathLike } from "fs";
import {
	HttpResponseRedirect,
	HttpSyncFileResponse,
} from "../modal/response";
import createError from "../tools/errorGenerator";

export type CallBackHandleMethod<T> =
	((content: Content<any>) => T) |
	((content: Content<any>, res: ServerResponse) => T) |
	((content: Content<any>, res: ServerResponse, callBack: (error: Error | null, value?: T) => void) => void)

export const FileResponse = function(filename?: string, asAttachment = false, encode = "UTF-8") {
	return function(
		target: any,
		propertyKey: string | symbol,
		descriptor: TypedPropertyDescriptor<CallBackHandleMethod<PathLike>>,
	) {
		const oldValue = descriptor.value;
		if (oldValue) {
			descriptor.value = function(
				content: Content,
				res: ServerResponse,
				next: (error: Error | null, data: PathLike) => void,
			) {
				const returnValue = oldValue(content, res, (error, value) => {
					if (error) {
						createError(res, 500, error.message);
					} else {
						new HttpSyncFileResponse(res, value, asAttachment, encode, filename).end();
					}
					next(error, "");
				});
				if (returnValue) {
					new HttpSyncFileResponse(res, returnValue, asAttachment, encode, filename).end();
					next(null, returnValue);
				}
				return returnValue;
			};
		}
		return descriptor;
	};
};

export function CheckLogin(redirect?: string) {
	return function(
		target: any,
		propertyKey: string | symbol,
		descriptor: TypedPropertyDescriptor<CallBackHandleMethod<any>>,
	) {
		const oldValue = descriptor.value;
		descriptor.value = (req, res, next) => {
			if (req.session && oldValue) {
				oldValue(req, res, next);
			} else if (redirect) {
				new HttpResponseRedirect(res, req, redirect).end();
				next(new Error("login required"));
			} else {
				createError(res, 401, "request unauthorized");
				next(new Error("request Forbidden"));
			}
		};
		return descriptor;
	};
}

export function CheckPermissions(checker: (content: Content<any>) => boolean) {
	return function(
		target: any,
		propertyKey: string | symbol,
		descriptor: TypedPropertyDescriptor<CallBackHandleMethod<any>>,
	) {
		const old = descriptor.value as CallBackHandleMethod<any>;
		descriptor.value = (content:Content<any>, res, callBack) => {
			if (checker(content)) {
				old(content, res, callBack);
			} else {
				createError(res, 403, "permission denied");
				callBack(new Error("permission denied"));
			}
		};
		return descriptor;
	};
}

export function RequestMapping(method = "get") {
	return function(target: any, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<any>) {
		if (!target.requestMap) {
			target.requestMap = new Map<string, (content: Content, res: ServerResponse, next: NoParamCallback) => any>();
		}
		target.requestMap.set(method.toLowerCase(), descriptor.value);
		return descriptor;
	};
}

// export function DataView()
