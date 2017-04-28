module.exports = function(ast, file) {
  let result = file
  for (let i = ast.body.length - 1; i >= 0; i--) {
    let node = ast.body[i]
    if (node.type == "GrammarDeclaration")
      result = result.slice(0, node.start) + compileGrammar(node, file) + result.slice(node.end)
  }
  return result
}

class Graph {
  constructor(grammar) {
    this.nodes = Object.create(null)
    this.curLabel = "-"
    this.grammar = grammar
    this.rules = Object.create(null)
    this.first = null
    for (let i = 0; i < grammar.rules.length; i++) {
      let rule = grammar.rules[i],
          start = this.node(rule.id.name),
          end = this.node(rule.id.name, "end")
      this.rules[rule.id.name] = {ast: rule, start, end}
      if (this.first == null && !rule.lexical) this.first = rule.id.name
    }
    for (let n in this.rules) {
      let {ast, start, end} = this.rules[n]
      this.withLabels(ast.id.name, () => {
        generateExpr(start, end, ast.expr, this)
        this.edge(end, null, new NullMatch(ast), [new ReturnEffect])
      })
    }
  }

  node(base, suffix) {
    let label = (base || this.curLabel) + (suffix ? "_" + suffix : "")
    for (let i = 0;; i++) {
      let cur = i ? label + "_" + i : label
      if (!(cur in this.nodes)) {
        this.nodes[cur] = []
        return cur
      }
    }
  }

  edge(from, to, match, effects) {
    let edge = new Edge(to, match, effects)
    this.nodes[from].push(edge)
    return edge
  }

  withLabels(label, f) {
    let prevLabel = this.curLabel
    this.curLabel = label
    f()
    this.curLabel = prevLabel
  }

  gc() {
    let reached = Object.create(null), work = []

    function reach(node) {
      if (node in reached) return
      reached[node] = true
      work.push(node)
    }
    reach(this.rules[this.first].start)

    while (work.length) {
      let next = this.nodes[work.pop()]
      for (let i = 0; i < next.length; i++) {
        let edge = next[i]
        if (edge.to) reach(edge.to)
        for (let j = 0; j < edge.effects.length; j++)
          if (edge.effects[j] instanceof CallEffect)
            reach(edge.effects[j].returnTo)
      }
    }

    for (let n in this.nodes) if (!(n in reached)) delete this.nodes[n]
  }
}

class Edge {
  constructor(to, match, effects) {
    this.to = to
    this.match = match
    this.effects = effects || []
  }

  toString(from) {
    let effects = this.effects.length ? " " + this.effects.join(" ") : ""
    return `${from} -> ${this.to || "NULL"}[label=${JSON.stringify(this.match.toString() + effects)}]`
  }
}

class Match {
  constructor(ast) { this.ast = ast }
}

class StringMatch extends Match {
  constructor(ast, string) {
    super(ast)
    this.string = string
  }

  toString() { return JSON.stringify(this.string) }
}

class RangeMatch extends Match {
  constructor(ast, from, to) {
    super(ast)
    this.from = from
    this.to = to
  }

  toString() { return JSON.stringify(this.from) + "-" + JSON.stringify(this.to) }
}

class AnyMatch extends Match {
  toString() { return "_" }
}

class NullMatch extends Match {
  toString() { return "ø" }
}

class SeqMatch extends Match {
  constructor(ast, matches) {
    super(ast)
    this.matches = matches
  }

  toString() { return this.matches.join(" ") }

  static create(left, right) {
    if (left instanceof NullMatch) return right
    if (right instanceof NullMatch) return left
    let matches = []
    if (left instanceof SeqMatch) matches = matches.concat(left.matches)
    else matches.push(left)
    let last = matches[matches.length - 1]
    if (right instanceof StringMatch && last instanceof StringMatch)
      matches[matches.length - 1] = new StringMatch(last.ast, last.value + right.value)
    else if (right instanceof SeqMatch) matches = matches.concat(right.matches)
    else matches.push(right)
    if (matches.length == 1) return matches[0]
    else return new SeqMatch(left.ast, matches)
  }
}

class ChoiceMatch extends Match {
  constructor(ast, matches) {
    super(ast)
    this.matches = matches
  }

  toString() { return "(" + this.matches.join(" | ") + ")" }

  static create(left, right) {
    let matches = []
    if (left instanceof ChoiceMatch) matches = matches.concat(left.matches)
    else matches.push(left)
    if (right instanceof ChoiceMatch) matches = matches.concat(right.matches)
    else matches.push(right)
    return new ChoiceMatch(left.ast, matches)
  }
}

class RepeatMatch extends Match {
  constructor(ast, match) {
    super(ast)
    this.match = match
  }

  toString() { return this.match.toString() + "*" }
}

class CallEffect {
  constructor(rule, returnTo) {
    this.rule = rule
    this.returnTo = returnTo
  }

  eq(other) {
    return other instanceof CallEffect && other.rule == this.rule && other.returnTo == this.returnTo
  }

  toString() { return `call ${this.rule} -> ${this.returnTo}` }
}

class ReturnEffect {
  constructor() {}

  eq(other) { return other instanceof ReturnEffect }

  toString() { return "return" }
}

function generateExpr(start, end, expr, graph) {
  let t = expr.type
  if (t == "CharacterRange") {
    graph.edge(start, end, new RangeMatch(expr, expr.from, expr.to))
  } else if (t == "StringMatch") {
    graph.edge(start, end, new StringMatch(expr, expr.value))
  } else if (t == "AnyMatch") {
    graph.edge(start, end, new AnyMatch(expr))
  } else if (t == "RuleIdentifier") {
    let rule = graph.rules[expr.id.name]
    if (!rule) throw new SyntaxError(`No rule '${expr.id.name}' defined`)
    graph.edge(start, rule.start, new NullMatch(expr), [new CallEffect(expr.id.name, end)])
  } else if (t == "RepeatedMatch") {
    if (expr.kind == "*") {
      graph.edge(start, end, new NullMatch(expr))
      generateExpr(start, start, expr.expr, graph)
    } else if (expr.kind == "+") {
      generateExpr(start, end, expr.expr, graph)
      generateExpr(end, end, expr.expr, graph)
    } else if (expr.kind == "?") {
      graph.edge(start, end, new NullMatch(expr))
      generateExpr(start, end, expr.expr, graph)
    }
  } else if (t == "LookaheadMatch") {
    throw new Error("not supporting lookahead yet")
  } else if (t == "SequenceMatch") {
    for (let i = 0; i < expr.exprs.length; i++) {
      let to = i == expr.exprs.length - 1 ? end : graph.node()
      generateExpr(start, to, expr.exprs[i], graph)
      start = to
    }
  } else if (t == "ChoiceMatch") {
    for (let i = 0; i < expr.exprs.length; i++)
      generateExpr(start, end, expr.exprs[i], graph)
  } else {
    throw new Error("Unrecognized AST node type " + t)
  }
}

function simplifySequence(graph, node, edges) {
  for (let i = 0; i < edges.length; i++) {
    let first = edges[i], next
    if (first.to == node || !first.to || (next = graph.nodes[first.to]).length != 1) continue
    let second = next[0], end = second.to, effects
    if (end == first.to) continue
    // If second is a return edge
    if (!end) for (let j = first.effects.length - 1; j >= 0; j--) {
      if (first.effects[j] instanceof CallEffect) {
      // Matching call found, wire directly to return address, remove call/return effects
        end = first.effects[j].returnTo
        effects = first.effects.slice(0, j).concat(first.effects.slice(j + 1))
          .concat(second.effects.filter(e => !(e instanceof ReturnEffect)))
      }
    }
    if (!effects) effects = first.effects.concat(second.effects)
    edges[i] = new Edge(end, SeqMatch.create(first.match, second.match), effects)
    return true
  }
  return false
}

function sameEffect(edge1, edge2) {
  let e1 = edge1.effects, e2 = edge2.effects
  if (e1.length != e2.length) return false
  for (let i = 0; i < e1.length; i++)
    if (!e1[i].eq(e2[i])) return false
  return true
}

function simplifyChoice(graph, node, edges) {
  if (edges.length < 2) return false
  let first = edges[0]
  for (let i = 1; i < edges.length; i++) {
    let edge = edges[i]
    if (edge.to != first.to || !sameEffect(edge, first)) return false
  }
  let match = first.match
  for (let i = 1; i < edges.length; i++)
    match = ChoiceMatch.create(match, edges[i].match)
  graph.nodes[node] = [new Edge(first.to, match, first.effects)]
  return true
}

function simplifyRepeat(graph, node, edges) {
  let cycleIndex, cycleEdge
  for (let i = 0; i < edges.length; i++) {
    let edge = edges[i]
    if (edge.to == node) {
      if (cycleEdge) return false
      cycleIndex = i
      cycleEdge = edge
    }
  }
  if (!cycleEdge || cycleEdge.effects.length) return false
  let newNode = graph.node(node, "split")
  graph.nodes[newNode] = edges.slice(0, cycleIndex).concat(edges.slice(cycleIndex + 1))
  graph.nodes[node] = [new Edge(newNode, new RepeatMatch(cycleEdge.match.ast, cycleEdge.match), cycleEdge.effects)]
  return true
}

// Look for simplification possibilities around the given node, return
// true if anything was done
function simplifyWith(graph, simplifiers) {
  let changed = false
  for (let node in graph.nodes) {
    let edges = graph.nodes[node]
    for (let i = 0; i < simplifiers.length; i++) if (simplifiers[i](graph, node, edges)) {
      changed = true
      break
    }
  }
  return changed
}

function simplify(graph) {
  while (simplifyWith(graph, [simplifySequence, simplifyChoice, simplifyRepeat])) {}
}

function printGraph(graph) {
  let output = "digraph {\n"
  for (let node in graph.nodes) {
    let edges = graph.nodes[node]
    for (let i = 0; i < edges.length; i++)
      output += "  " + edges[i].toString(node) + ";\n"
  }
  return output + "}\n"
}

function compileGrammar(grammar, file) {
  let graph = new Graph(grammar)
  simplify(graph)
  graph.gc()
  console.log(printGraph(graph))
  return "FIXME"
}