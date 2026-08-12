import type { FoldProfile } from "./fold-profile";
import { lengthNumberToCanonical } from "./calculation-decimal";
import {
  LENGTH_DECIMAL_POLICY,
  normalizeDecimalString,
} from "./fold-document/decimal";

export const FOLD_EXPRESSION_GRAMMAR_VERSION = "fold-expression-v1" as const;
export const FOLD_VARIABLE_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;

export type FoldExpressionIssueCode =
  | "INVALID_VARIABLE_NAME"
  | "DUPLICATE_VARIABLE"
  | "INVALID_VARIABLE_VALUE"
  | "SYNTAX_ERROR"
  | "UNKNOWN_VARIABLE"
  | "DIVISION_BY_ZERO"
  | "CIRCULAR_REFERENCE"
  | "RESULT_OUT_OF_RANGE"
  | "NON_POSITIVE_LENGTH";

export type FoldExpressionIssue = {
  code: FoldExpressionIssueCode;
  path: string;
  message: string;
};

type Token =
  | { kind: "number"; value: string; position: number }
  | { kind: "identifier"; value: string; position: number }
  | { kind: "operator"; value: "+" | "-" | "*" | "/" | "(" | ")"; position: number }
  | { kind: "end"; position: number };

type ExpressionNode =
  | { kind: "number"; value: string }
  | { kind: "variable"; name: string }
  | { kind: "unary"; operator: "+" | "-"; operand: ExpressionNode }
  | { kind: "binary"; operator: "+" | "-" | "*" | "/"; left: ExpressionNode; right: ExpressionNode };

type Fraction = { numerator: bigint; denominator: bigint };

class ExpressionFailure extends Error {
  constructor(
    readonly code: FoldExpressionIssueCode,
    message: string,
  ) {
    super(message);
  }
}

const TEN = BigInt(10);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const MAX_EXPRESSION_NODES = 256;
const MAX_EXPRESSION_DEPTH = 32;

function absolute(value: bigint) {
  return value < ZERO ? -value : value;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  left = absolute(left);
  right = absolute(right);
  while (right !== ZERO) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left === ZERO ? ONE : left;
}

function fraction(numerator: bigint, denominator = ONE): Fraction {
  if (denominator === ZERO) {
    throw new ExpressionFailure("DIVISION_BY_ZERO", "0으로 나눌 수 없습니다.");
  }
  const sign = denominator < ZERO ? -ONE : ONE;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return {
    numerator: (numerator / divisor) * sign,
    denominator: absolute(denominator) / divisor,
  };
}

function decimalFraction(value: string): Fraction {
  const [integer, decimal = ""] = value.split(".");
  const denominator = TEN ** BigInt(decimal.length);
  return fraction(BigInt(`${integer}${decimal}`), denominator);
}

function add(left: Fraction, right: Fraction) {
  return fraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function subtract(left: Fraction, right: Fraction) {
  return fraction(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function multiply(left: Fraction, right: Fraction) {
  return fraction(left.numerator * right.numerator, left.denominator * right.denominator);
}

function divide(left: Fraction, right: Fraction) {
  return fraction(left.numerator * right.denominator, left.denominator * right.numerator);
}

function fractionToCanonical(value: Fraction, scale = 6): string {
  const negative = value.numerator < ZERO;
  const scaled = absolute(value.numerator) * TEN ** BigInt(scale);
  let coefficient = scaled / value.denominator;
  const remainder = scaled % value.denominator;
  if (remainder * BigInt(2) >= value.denominator) coefficient += ONE;
  if (negative) coefficient = -coefficient;

  const sign = coefficient < ZERO ? "-" : "";
  const digits = absolute(coefficient).toString().padStart(scale + 1, "0");
  const raw = scale === 0
    ? `${sign}${digits}`
    : `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return normalizeDecimalString(raw, LENGTH_DECIMAL_POLICY);
}

function tokenize(source: string): Token[] {
  if (source.length < 1 || source.length > 512) {
    throw new ExpressionFailure("SYNTAX_ERROR", "수식은 1~512자로 입력하세요.");
  }
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (/[0-9]/.test(character)) {
      const start = index;
      while (/[0-9]/.test(source[index] ?? "")) index += 1;
      if (source[index] === ".") {
        index += 1;
        const fractionStart = index;
        while (/[0-9]/.test(source[index] ?? "")) index += 1;
        if (fractionStart === index) {
          throw new ExpressionFailure("SYNTAX_ERROR", `${start + 1}번째 위치의 숫자 형식이 올바르지 않습니다.`);
        }
      }
      const value = source.slice(start, index);
      if ((value.split(".")[1]?.length ?? 0) > 6) {
        throw new ExpressionFailure("SYNTAX_ERROR", "숫자 상수는 소수 6자리까지 입력할 수 있습니다.");
      }
      tokens.push({ kind: "number", value, position: start });
      continue;
    }
    if (/[A-Za-z]/.test(character)) {
      const start = index;
      while (/[A-Za-z0-9_]/.test(source[index] ?? "")) index += 1;
      const value = source.slice(start, index).toUpperCase();
      if (!FOLD_VARIABLE_NAME_PATTERN.test(value)) {
        throw new ExpressionFailure("SYNTAX_ERROR", `${start + 1}번째 위치의 변수명이 올바르지 않습니다.`);
      }
      tokens.push({ kind: "identifier", value, position: start });
      continue;
    }
    if (["+", "-", "*", "/", "(", ")"].includes(character)) {
      tokens.push({
        kind: "operator",
        value: character as Extract<Token, { kind: "operator" }>["value"],
        position: index,
      });
      index += 1;
      continue;
    }
    throw new ExpressionFailure("SYNTAX_ERROR", `${index + 1}번째 위치에 사용할 수 없는 문자가 있습니다.`);
  }
  tokens.push({ kind: "end", position: source.length });
  return tokens;
}

class Parser {
  private index = 0;
  private nodeCount = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): ExpressionNode {
    const expression = this.parseExpression(0);
    const token = this.current();
    if (token.kind !== "end") {
      throw new ExpressionFailure("SYNTAX_ERROR", `${token.position + 1}번째 위치의 입력을 해석할 수 없습니다.`);
    }
    return expression;
  }

  private current() {
    return this.tokens[this.index];
  }

  private consume() {
    const token = this.current();
    this.index += 1;
    return token;
  }

  private node<T extends ExpressionNode>(node: T, depth: number): T {
    this.nodeCount += 1;
    if (this.nodeCount > MAX_EXPRESSION_NODES || depth > MAX_EXPRESSION_DEPTH) {
      throw new ExpressionFailure("SYNTAX_ERROR", "수식이 너무 복잡합니다.");
    }
    return node;
  }

  private parseExpression(depth: number): ExpressionNode {
    let left = this.parseTerm(depth + 1);
    while (true) {
      const token = this.current();
      if (token.kind !== "operator" || (token.value !== "+" && token.value !== "-")) break;
      const operator = (this.consume() as Extract<Token, { kind: "operator" }>).value as "+" | "-";
      left = this.node({ kind: "binary", operator, left, right: this.parseTerm(depth + 1) }, depth);
    }
    return left;
  }

  private parseTerm(depth: number): ExpressionNode {
    let left = this.parseUnary(depth + 1);
    while (true) {
      const token = this.current();
      if (token.kind !== "operator" || (token.value !== "*" && token.value !== "/")) break;
      const operator = (this.consume() as Extract<Token, { kind: "operator" }>).value as "*" | "/";
      left = this.node({ kind: "binary", operator, left, right: this.parseUnary(depth + 1) }, depth);
    }
    return left;
  }

  private parseUnary(depth: number): ExpressionNode {
    const token = this.current();
    if (token.kind === "operator" && (token.value === "+" || token.value === "-")) {
      this.consume();
      return this.node({ kind: "unary", operator: token.value, operand: this.parseUnary(depth + 1) }, depth);
    }
    return this.parsePrimary(depth + 1);
  }

  private parsePrimary(depth: number): ExpressionNode {
    const token = this.consume();
    if (token.kind === "number") return this.node({ kind: "number", value: token.value }, depth);
    if (token.kind === "identifier") return this.node({ kind: "variable", name: token.value }, depth);
    if (token.kind === "operator" && token.value === "(") {
      const expression = this.parseExpression(depth + 1);
      const closing = this.consume();
      if (closing.kind !== "operator" || closing.value !== ")") {
        throw new ExpressionFailure("SYNTAX_ERROR", "닫는 괄호가 필요합니다.");
      }
      return expression;
    }
    throw new ExpressionFailure("SYNTAX_ERROR", `${token.position + 1}번째 위치에 숫자나 변수가 필요합니다.`);
  }
}

function parseExpression(source: string) {
  return new Parser(tokenize(source.trim())).parse();
}

function collectVariables(node: ExpressionNode, variables = new Set<string>()): Set<string> {
  if (node.kind === "variable") variables.add(node.name);
  if (node.kind === "unary") collectVariables(node.operand, variables);
  if (node.kind === "binary") {
    collectVariables(node.left, variables);
    collectVariables(node.right, variables);
  }
  return variables;
}

function evaluateNode(
  node: ExpressionNode,
  resolveVariable: (name: string) => Fraction,
): Fraction {
  if (node.kind === "number") return decimalFraction(node.value);
  if (node.kind === "variable") return resolveVariable(node.name);
  if (node.kind === "unary") {
    const operand = evaluateNode(node.operand, resolveVariable);
    return node.operator === "-" ? fraction(-operand.numerator, operand.denominator) : operand;
  }
  const left = evaluateNode(node.left, resolveVariable);
  const right = evaluateNode(node.right, resolveVariable);
  if (node.operator === "+") return add(left, right);
  if (node.operator === "-") return subtract(left, right);
  if (node.operator === "*") return multiply(left, right);
  return divide(left, right);
}

function issueFromFailure(path: string, error: unknown): FoldExpressionIssue {
  const failure = error instanceof ExpressionFailure
    ? error
    : new ExpressionFailure("RESULT_OUT_OF_RANGE", "수식 결과가 허용 범위를 벗어났습니다.");
  return { code: failure.code, path, message: failure.message };
}

function validateResult(value: Fraction, constraint: "any" | "positive" | "nonnegative"): string {
  let canonical: string;
  try {
    canonical = fractionToCanonical(value);
  } catch {
    throw new ExpressionFailure("RESULT_OUT_OF_RANGE", "수식 결과는 mm 소수 6자리 범위여야 합니다.");
  }
  if (constraint === "positive" && Number(canonical) <= 0) {
    throw new ExpressionFailure("NON_POSITIVE_LENGTH", "구간 길이 수식 결과는 0보다 커야 합니다.");
  }
  if (constraint === "nonnegative" && Number(canonical) < 0) {
    throw new ExpressionFailure("NON_POSITIVE_LENGTH", "제품 길이 수식 결과는 0 이상이어야 합니다.");
  }
  return canonical;
}

export function normalizeFoldVariableName(name: string) {
  return name.trim().toUpperCase();
}

export function replaceFoldExpressionIdentifier(source: string, from: string, to: string) {
  return source.replace(/[A-Za-z][A-Za-z0-9_]*/g, (token) =>
    token.toUpperCase() === from.toUpperCase() ? to : token.toUpperCase(),
  );
}

export type FoldExpressionResolution = {
  variableValues: Record<string, string>;
  segmentLengths: Record<string, string>;
  productLengthDecimal: string;
  issues: FoldExpressionIssue[];
};

export function resolveFoldProfileExpressions(profile: FoldProfile): FoldExpressionResolution {
  const issues: FoldExpressionIssue[] = [];
  const variableValues: Record<string, string> = {};
  const variableNodes = new Map<string, { node?: ExpressionNode; index: number; value: number }>();
  const invalidVariableNames = new Set<string>();

  profile.variables.forEach((variable, index) => {
    const name = normalizeFoldVariableName(variable.name);
    const path = `variables[${index}]`;
    if (!FOLD_VARIABLE_NAME_PATTERN.test(name)) {
      issues.push({ code: "INVALID_VARIABLE_NAME", path: `${path}.name`, message: "변수명은 영문 대문자로 시작하고 영문·숫자·_만 사용할 수 있습니다." });
      return;
    }
    if (variableNodes.has(name)) {
      issues.push({ code: "DUPLICATE_VARIABLE", path: `${path}.name`, message: `${name} 변수가 중복되었습니다.` });
      return;
    }
    let node: ExpressionNode | undefined;
    if (variable.formula?.trim()) {
      try {
        node = parseExpression(variable.formula);
      } catch (error) {
        issues.push(issueFromFailure(`${path}.formula`, error));
        invalidVariableNames.add(name);
      }
    } else {
      try {
        lengthNumberToCanonical(variable.value);
      } catch {
        issues.push({ code: "INVALID_VARIABLE_VALUE", path: `${path}.value`, message: `${name} 변수값이 허용 범위를 벗어났습니다.` });
      }
    }
    variableNodes.set(name, { node, index, value: variable.value });
  });

  const visiting: string[] = [];
  const failed = new Set<string>();
  const resolveVariable = (name: string): Fraction => {
    if (variableValues[name] !== undefined) return decimalFraction(variableValues[name]);
    const definition = variableNodes.get(name);
    if (!definition) {
      throw new ExpressionFailure("UNKNOWN_VARIABLE", `${name} 변수값이 없습니다.`);
    }
    if (invalidVariableNames.has(name)) {
      throw new ExpressionFailure("UNKNOWN_VARIABLE", `${name} 변수 수식에 오류가 있습니다.`);
    }
    if (failed.has(name)) {
      throw new ExpressionFailure("UNKNOWN_VARIABLE", `${name} 변수를 계산할 수 없습니다.`);
    }
    const cycleIndex = visiting.indexOf(name);
    if (cycleIndex >= 0) {
      const cycle = [...visiting.slice(cycleIndex), name];
      cycle.forEach((item) => failed.add(item));
      throw new ExpressionFailure("CIRCULAR_REFERENCE", `순환 참조가 있습니다: ${cycle.join(" → ")}`);
    }

    visiting.push(name);
    try {
      const value = definition.node
        ? evaluateNode(definition.node, resolveVariable)
        : decimalFraction(lengthNumberToCanonical(definition.value));
      const canonical = validateResult(value, "any");
      variableValues[name] = canonical;
      return decimalFraction(canonical);
    } catch (error) {
      failed.add(name);
      if (!issues.some((issue) => issue.path === `variables[${definition.index}].formula`)) {
        issues.push(issueFromFailure(`variables[${definition.index}].formula`, error));
      }
      throw error;
    } finally {
      visiting.pop();
    }
  };

  for (const name of variableNodes.keys()) {
    try {
      resolveVariable(name);
    } catch {
      // 각 변수 경로의 issue는 resolveVariable에서 기록한다.
    }
  }

  const evaluateSource = (
    source: string,
    path: string,
    constraint: "positive" | "nonnegative",
  ) => {
    try {
      const node = parseExpression(source);
      for (const dependency of collectVariables(node)) {
        if (variableValues[dependency] === undefined) resolveVariable(dependency);
      }
      return validateResult(evaluateNode(node, resolveVariable), constraint);
    } catch (error) {
      issues.push(issueFromFailure(path, error));
      return undefined;
    }
  };

  const segmentLengths: Record<string, string> = {};
  profile.blocks.forEach((block, blockIndex) => block.segments.forEach((segment, segmentIndex) => {
    if (!segment.formula?.trim()) return;
    const value = evaluateSource(
      segment.formula,
      `blocks[${blockIndex}].segments[${segmentIndex}].formula`,
      "positive",
    );
    if (value !== undefined) segmentLengths[segment.id] = value;
  }));

  let productLengthDecimal = lengthNumberToCanonical(profile.product.length);
  if (profile.product.formulaEnabled && profile.product.formula?.trim()) {
    const value = evaluateSource(profile.product.formula, "product.formula", "nonnegative");
    if (value !== undefined) productLengthDecimal = value;
  }

  return { variableValues, segmentLengths, productLengthDecimal, issues };
}
