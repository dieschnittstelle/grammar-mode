import * as grammar from "../../srcgen/java.mode.js";
import {markLocals, markTypeLocals} from "./google-modes/locals.js";
import {indent} from "./google-modes/c_indent.js";

const scopes = ["Block", "FunctionDef", "Lambda"]
const typeScopes = ["ClassItem", "Statement", "AnnotationTypeItem"]

class JavaMode extends CodeMirror.GrammarMode {
  constructor(conf) {
    super(grammar)
    this.indentConf = {doubleIndentBrackets: ">)", dontCloseBrackets: ")", align: false,
      tabSize: conf.tabSize, indentUnit: conf.indentUnit}
  }

  token(stream, state) {
    console.log("token()");
    // console.log("token()",stream);
    return markTypeLocals(markLocals(super.token(stream, state), scopes, stream, state), typeScopes, stream, state)
  }

  indent(state, textAfter, line) {
    console.log("indent()");
    if (!textAfter) textAfter = line = "x" // Force getContextAt to terminate the statement, if needed
    return indent(state, textAfter, line, this.indentConf)
  }
}

JavaMode.prototype.electricInput = /^\s*(?:case .*?:|default:|\{\}?|\})$/
JavaMode.prototype.blockCommentStart = "/*"
JavaMode.prototype.blockCommentEnd = "*/"
JavaMode.prototype.blockCommentContinue = " * "
JavaMode.prototype.lineComment = "//"
JavaMode.prototype.fold = "brace"

let modename = "test-java";
console.log("defining mode: " + modename);
CodeMirror.defineMode(modename, conf => new JavaMode(conf))
