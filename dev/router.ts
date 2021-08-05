import SkadiFramework from "../index";
import {
	CheckLogin,
	CheckPermissions,
	FileResponse,
	RequestMapping,
} from "../Controller/Controller";
import { Content } from "../core/Security";
import { Service } from "../Controller/classDeclarations";
import { PathLike } from "fs";
import { ServerResponse } from "http";
import { join } from "path";
import { HttpResponseBadRequest, HttpResponseRedirect, JsonResponse } from "../modal/response";

const Router = SkadiFramework.Router;

@Service
class Main {
	@RequestMapping()
	@FileResponse("login.html")
	postFile(content: Content, res: ServerResponse, next: (arg0: Error | null, arg1?: PathLike) => void) {
		// if (!content.session && content.body) {
		// 	content.session = { userName: content.body.userName };
		// } else {
		// 	console.log(content.session);
		// }
		next(null, join(__dirname, "../asset/html/login.html"));
	}

	@RequestMapping("post")
	login(content: Content<any, { userName: string }>, server: ServerResponse, next: (arg0: Error | null) => void) {
		if (content.body) {
			if (content.body.userName === "123" || content.body.userName === "1234") {
				content.session = content.body;
				new HttpResponseRedirect(server, content, "/d").end();
			} else {
				new HttpResponseRedirect(server, content, "/").end();
			}
		} else {
			new HttpResponseBadRequest(server, "no body get").end();
		}
		// content.session = content.body;

		next(null);
	}
}

@Service
class C {
	@RequestMapping()
	@CheckLogin("/")
	@CheckPermissions((content: Content<{ userName: string }>) => content.session.userName === "123")
	getFile(content: Content<{ d: number }>, server: ServerResponse, next: (arg0: Error | null) => void) {
		new JsonResponse(server, content.session).end();
		next(null);
	}
}

export default new Router({
	routes: [
		{
			path: "/",
			view: new Main(),
			children: [
				{
					path: "d",
					view: new C(),
				},
			],
		},
	],
});
