import {
	HttpResponseForbidden,
	HttpResponseNotAllowed,
	HttpResponseServerError,
	HttpResponseUnauthorized,
} from "../modal/response";
import { ServerResponse } from "http";

export default function createError(res: ServerResponse, code: number, message?: string) {
	switch (code) {
	case 401:
		new HttpResponseUnauthorized(res, message).end();
		break;
	case 403:
		new HttpResponseForbidden(res, message).end();
		break;
	case 500:
		new HttpResponseServerError(res, message).end();
		break;
	}
}
