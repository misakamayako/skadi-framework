import { Key, pathToRegexp } from "path-to-regexp";
import assert = require("assert");
import { ServerResponse } from "http";
import { Http404, HttpResponseBadRequest, HttpResponseNotFound, HttpResponseServerError } from "../modal/response";
import { NoParamCallback } from "fs";
import { Content } from "../core/Security";

interface View extends Object {
	requestHandle: (content: Content, res: ServerResponse, next: NoParamCallback) => void;
}

interface PathToRegexpOptions {
	sensitive?: boolean;
	strict?: boolean;
	end?: boolean;
}

interface RouteConfig {
	base?: string;
	routes?: Array<Route>;
}

interface Route {
	path: string;
	name?: string;
	// controller?: Controller;
	view?: any;
	redirect?: string;
	children?: Array<Route>;
	caseSensitive?: boolean;
	PathToRegexpOptions?: PathToRegexpOptions;
}

interface RouteRecord {
	path: string;
	regexp: RegExp;
	view?: any;
	name?: string;
	parent?: RouteRecord;
	redirect?: string;
	// beforeEnter?: unknown;
	caseSensitive?: boolean;
	pathToRegexpOptions?: PathToRegexpOptions;
	matchAs?: string;
}

export default class Router {
	base: string;
	route: Array<Route>;
	private readonly PathHashMap: Map<string, RouteRecord>;
	private readonly NameHashMap: Map<string, RouteRecord>;
	private readonly PathList: Set<string>;

	constructor(routeConfig?: RouteConfig) {
		console.time("start init router");
		const start = Date.now();
		const PathHashMap: Map<string, RouteRecord> = new Map();
		const NameHashMap: Map<string, RouteRecord> = new Map();
		const PathList: Set<string> = new Set();
		this.base = this.normalizePath(routeConfig?.base || "/");
		this.route = routeConfig?.routes || [];
		for (let i = 0; i < this.route.length; i++) {
			this.addRouteRecord(this.route[i], PathHashMap, NameHashMap, PathList, this.route[i].path);
		}
		this.PathHashMap = PathHashMap;
		this.NameHashMap = NameHashMap;
		this.PathList = PathList;
		console.log(`route init finished, last for ${Date.now() - start}ms`);
	}

	addRouteRecord(
		route: Route,
		PathHash?: Map<string, RouteRecord>,
		NameHash?: Map<string, RouteRecord>,
		PathList?: Set<string>,
		matchAs?: string,
		parent?: RouteRecord
	): void {
		if (PathHash === undefined) {
			PathHash = this.PathHashMap;
		}
		if (NameHash === undefined) {
			NameHash = this.NameHashMap;
		}
		if (PathList === undefined) {
			PathList = this.PathList;
		}
		const { path, name } = route;
		if (process.env.NODE_ENV !== "production") {
			assert.ok(path, "'path' is required in route config");
			assert.ok(route.view === undefined || route.view, "'view' must be instance of View or undefined");
			assert.ok(
				// eslint-disable-next-line no-control-regex
				!/[^\u0000-\u007F]+/.test(path),
				`Route with path "${path}" contains unencoded characters, please make sure your path is correctly encoded`
			);
		}
		const pathToRegexpOptions = route.PathToRegexpOptions || {};
		const normalizedPath = this.normalizePath(path, parent, pathToRegexpOptions.strict);
		const record: RouteRecord = {
			caseSensitive: route.caseSensitive,
			name,
			parent,
			path: normalizedPath,
			pathToRegexpOptions,
			redirect: route.redirect,
			regexp: this.compileRouteRegex(path, pathToRegexpOptions),
			view: route.view,
			matchAs: matchAs,
		};
		if (route.children) {
			route.children.forEach((child) => {
				const childMatchAs = matchAs ? this.cleanPath(`${matchAs}/${child.path}`) : undefined;
				this.addRouteRecord(child, PathHash, NameHash, PathList, childMatchAs, record);
			});
		}
		if (!PathList.has(record.path)) {
			PathList.add(record.path);
			PathHash.set(record.path, record);
		}
		if (name) {
			if (!NameHash.has(name)) {
				NameHash.set(name, record);
			} else if (process.env.NODE_ENV !== "production") {
				assert(false, `Duplicate named route definition: { name: "${name}", path: "${path}"}`);
			}
		}
	}

	normalizePath(path: string, parent?: RouteRecord, strict?: boolean): string {
		if (!strict) path = path.replace(/\/$/, "");
		if (path[0] === "/") return path;
		if (!parent) return path;
		return this.cleanPath(`${parent.path}/${path}`);
	}

	cleanPath(path: string): string {
		return path.replace(/\/\//g, "/");
	}

	compileRouteRegex(path: string, pathToRegexpOptions: PathToRegexpOptions): RegExp {
		const keys: Key[] = [];
		const regex = pathToRegexp(path, keys, pathToRegexpOptions);
		if (process.env.NODE_ENV !== "production") {
			const verify = Object.create(null);
			keys.forEach(function (key) {
				assert.ok(!verify[key.name], `Duplicate param keys in route with path: "${path}"`);
				verify[key.name] = true;
			});
		}
		return regex;
	}

	match(path: string): RouteRecord | undefined {
		path = this.normalizePath(path);
		let record: RouteRecord | undefined;
		if (path.startsWith(this.base)) {
			path = path.replace(new RegExp(`^${this.base}$`), "");
		} else {
			return this.PathHashMap.get("/404");
		}
		record = this.PathHashMap.get(path);
		if (!record) {
			const entries = this.PathHashMap.entries();
			let next;
			while ((next = entries.next()).done === false) {
				if (next.value[1].regexp.test(path)) {
					record = next.value[1];
					break;
				}
			}
		}
		if (!record) {
			record = this.PathHashMap.get("/404");
		}
		return record;
	}

	handle(content: Content<unknown>, res: ServerResponse, next: NoParamCallback) {
		const requestPath = content.url;
		if (!requestPath) {
			new HttpResponseBadRequest(res, "unknown request").end();
			next(new Error("unknown request"));
			return;
		}
		if (!requestPath.startsWith(this.base)) {
			new HttpResponseNotFound(
				res,
				"request url" + content.url + " is not sub of current server's base:" + this.base
			).end();
			next(new Error("request url" + content.url + " is not sub of current server's base:" + this.base));
			return;
		}
		const record = this.match(requestPath);
		if (record) {
			if (record.view) {
				if (Reflect.get(record.view, "requestHandle")) {
					Reflect.get(record.view, "requestHandle")(content, res, next);
				} else {
					new Http404(res, "can't find page: " + content.url).end();
					next(null);
				}
			} else {
				new HttpResponseServerError(res, `this url ${requestPath} has resigned, but have not implemented`)
					.setStatus(501)
					.end();
				next(new Error(`this url ${requestPath} has resigned, but have not implemented`));
			}
		} else {
			new HttpResponseNotFound(res, `can not find page ${requestPath}`).end();
			next(new Error(`can not find page ${requestPath}`));
		}
	}
}
