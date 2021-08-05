import Dict = NodeJS.Dict;
import { ServerResponse } from "http";
import { Content } from "../../core/Security";
interface Params {
	key:string,
	type?:string[]|string,
	required?:boolean
}
export abstract class ViewBase {
	allowMethod: string[] = [];
	abstract params?:Params[];
	requestTest(request:Content,response:ServerResponse){
		// request.
	}
}
