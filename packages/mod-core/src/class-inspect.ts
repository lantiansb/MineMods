// Read-only JVM evidence. This does not load classes or recover Java source.
// Format: https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-4.html
type Constant = { tag: number; text?: string; a?: number; b?: number }

const names =
  `nop aconst_null iconst_m1 iconst_0 iconst_1 iconst_2 iconst_3 iconst_4 iconst_5 lconst_0 lconst_1 fconst_0 fconst_1 fconst_2 dconst_0 dconst_1 bipush sipush ldc ldc_w ldc2_w iload lload fload dload aload iload_0 iload_1 iload_2 iload_3 lload_0 lload_1 lload_2 lload_3 fload_0 fload_1 fload_2 fload_3 dload_0 dload_1 dload_2 dload_3 aload_0 aload_1 aload_2 aload_3 iaload laload faload daload aaload baload caload saload istore lstore fstore dstore astore istore_0 istore_1 istore_2 istore_3 lstore_0 lstore_1 lstore_2 lstore_3 fstore_0 fstore_1 fstore_2 fstore_3 dstore_0 dstore_1 dstore_2 dstore_3 astore_0 astore_1 astore_2 astore_3 iastore lastore fastore dastore aastore bastore castore sastore pop pop2 dup dup_x1 dup_x2 dup2 dup2_x1 dup2_x2 swap iadd ladd fadd dadd isub lsub fsub dsub imul lmul fmul dmul idiv ldiv fdiv ddiv irem lrem frem drem ineg lneg fneg dneg ishl lshl ishr lshr iushr lushr iand land ior lor ixor lxor iinc i2l i2f i2d l2i l2f l2d f2i f2l f2d d2i d2l d2f i2b i2c i2s lcmp fcmpl fcmpg dcmpl dcmpg ifeq ifne iflt ifge ifgt ifle if_icmpeq if_icmpne if_icmplt if_icmpge if_icmpgt if_icmple if_acmpeq if_acmpne goto jsr ret tableswitch lookupswitch ireturn lreturn freturn dreturn areturn return getstatic putstatic getfield putfield invokevirtual invokespecial invokestatic invokeinterface invokedynamic new newarray anewarray arraylength athrow checkcast instanceof monitorenter monitorexit wide multianewarray ifnull ifnonnull goto_w jsr_w`.split(
    " ",
  )

function modifiedUtf8(bytes: Buffer) {
  const units: number[] = []
  for (let i = 0; i < bytes.length; ) {
    const a = bytes[i++]!
    if (a > 0 && a < 128) {
      units.push(a)
      continue
    }
    const b = bytes[i++]
    if (b === undefined || (b & 0xc0) !== 0x80) throw new Error("Invalid class UTF-8")
    if ((a & 0xe0) === 0xc0) {
      const unit = ((a & 31) << 6) | (b & 63)
      if ((unit === 0 && (a !== 0xc0 || b !== 0x80)) || (unit > 0 && unit < 0x80))
        throw new Error("Invalid class UTF-8")
      units.push(unit)
      continue
    }
    const c = bytes[i++]
    if ((a & 0xf0) !== 0xe0 || c === undefined || (c & 0xc0) !== 0x80) throw new Error("Invalid class UTF-8")
    const unit = ((a & 15) << 12) | ((b & 63) << 6) | (c & 63)
    if (unit < 0x800) throw new Error("Invalid class UTF-8")
    units.push(unit)
  }
  return units.map((unit) => String.fromCharCode(unit)).join("")
}

export function inspectJavaClass(
  input: Uint8Array,
  methodName?: string,
  options: {
    maxInstructions?: number
    /** Disassemble every method, not just `methodName`. For whole-class analysis such as model reconstruction. */
    allMethods?: boolean
  } = {},
) {
  if (input.byteLength > 8 * 1024 * 1024) throw new Error("Class evidence exceeds 8 MiB")
  if (methodName !== undefined && (!methodName || methodName.length > 512))
    throw new Error("Invalid Java method selector")
  const maxInstructions = options.maxInstructions ?? 1200
  if (!Number.isInteger(maxInstructions) || maxInstructions < 1 || maxInstructions > 4096)
    throw new Error("Invalid Java instruction evidence limit")
  const bytes = Buffer.from(input),
    pool: Constant[] = [{ tag: 0 }]
  let position = 0,
    truncated = false,
    instructionCount = 0
  const take = (length: number) => {
    if (length < 0 || !Number.isSafeInteger(length) || position + length > bytes.length)
      throw new Error("Truncated class file")
    const result = bytes.subarray(position, position + length)
    position += length
    return result
  }
  const u1 = () => take(1).readUInt8(),
    u2 = () => take(2).readUInt16BE(),
    u4 = () => take(4).readUInt32BE()
  if (u4() !== 0xcafebabe) throw new Error("Invalid Java class magic")
  const minor = u2(),
    major = u2(),
    count = u2()
  for (let i = 1; i < count; i++) {
    const tag = u1()
    if (tag === 1) {
      pool.push({ tag, text: modifiedUtf8(take(u2())) })
      continue
    }
    if (tag === 3 || tag === 4) {
      const data = take(4)
      pool.push({ tag, text: String(tag === 3 ? data.readInt32BE() : data.readFloatBE()) })
      continue
    }
    if (tag === 5 || tag === 6) {
      const data = take(8)
      pool.push({ tag, text: tag === 5 ? data.readBigInt64BE().toString() : String(data.readDoubleBE()) }, { tag: 0 })
      i++
      continue
    }
    if ([7, 8, 16, 19, 20].includes(tag)) {
      pool.push({ tag, a: u2() })
      continue
    }
    if ([9, 10, 11, 12, 17, 18].includes(tag)) {
      pool.push({ tag, a: u2(), b: u2() })
      continue
    }
    if (tag === 15) {
      pool.push({ tag, a: u1(), b: u2() })
      continue
    }
    throw new Error(`Unsupported constant pool tag: ${tag}`)
  }
  const ref = (index: number, depth = 0): string => {
    const entry = pool[index]
    if (!entry || !entry.tag || depth > 8) throw new Error("Invalid constant pool reference")
    if (entry.text !== undefined) return entry.text
    if ([7, 8, 16, 19, 20].includes(entry.tag)) return ref(entry.a!, depth + 1)
    if ([17, 18].includes(entry.tag)) return `bootstrap#${entry.a} ${ref(entry.b!, depth + 1)}`
    if (entry.tag === 15) return `handle#${entry.a} ${ref(entry.b!, depth + 1)}`
    return `${ref(entry.a!, depth + 1)}${entry.tag === 12 ? ":" : "."}${ref(entry.b!, depth + 1)}`
  }
  const utf8 = (index: number) => {
    const entry = pool[index]
    if (entry?.tag !== 1 || entry.text === undefined) throw new Error("Invalid constant pool UTF-8 reference")
    return entry.text
  }
  const className = (index: number) => {
    const entry = pool[index]
    if (entry?.tag !== 7 || entry.a === undefined) throw new Error("Invalid constant pool class reference")
    return utf8(entry.a)
  }
  const attributes = () => {
    const count = u2()
    if (count > 4096) throw new Error("Class attribute count exceeds limit")
    return Array.from({ length: count }, () => ({ name: utf8(u2()), data: take(u4()) }))
  }
  const instructions = (code: Buffer) => {
    const result: string[] = []
    for (let pc = 0; pc < code.length; ) {
      const offset = pc,
        op = code[pc++]!,
        name = names[op]
      if (!name) throw new Error("Unsupported JVM opcode")
      if (++instructionCount > 12000) throw new Error("Class method instruction evidence exceeds limit")
      const length =
        op === 16 || op === 18 || (op >= 21 && op <= 25) || (op >= 54 && op <= 58) || op === 169 || op === 188
          ? 1
          : op === 17 ||
              op === 19 ||
              op === 20 ||
              op === 132 ||
              (op >= 153 && op <= 168) ||
              (op >= 178 && op <= 184) ||
              [187, 189, 192, 193, 198, 199].includes(op)
            ? 2
            : op === 197
              ? 3
              : [185, 186, 200, 201].includes(op)
                ? 4
                : 0
      if (pc + length > code.length) throw new Error("Truncated bytecode instruction")
      const operands = code.subarray(pc, pc + length)
      pc += length
      let suffix = operands.length ? ` ${operands.toString("hex")}` : ""
      if (op === 170 || op === 171) {
        pc += (4 - (pc % 4)) % 4
        if (pc + (op === 170 ? 12 : 8) > code.length) throw new Error("Truncated switch instruction")
        const start = pc,
          entries = op === 170 ? code.readInt32BE(pc + 8) - code.readInt32BE(pc + 4) + 1 : code.readInt32BE(pc + 4)
        if (entries < 0 || entries > 16384) throw new Error("Invalid bytecode switch")
        pc += (op === 170 ? 12 : 8) + entries * (op === 170 ? 4 : 8)
        if (pc > code.length) throw new Error("Truncated switch instruction")
        suffix = ` ${code.subarray(start, pc).toString("hex")}`
      }
      if (op === 196) {
        const widened = code[pc]
        if (widened === undefined || ![21, 22, 23, 24, 25, 54, 55, 56, 57, 58, 132, 169].includes(widened))
          throw new Error("Invalid wide instruction")
        const end = pc + (widened === 132 ? 5 : 3)
        if (end > code.length) throw new Error("Truncated wide instruction")
        suffix = ` ${names[widened]} ${code.subarray(pc + 1, end).toString("hex")}`
        pc = end
      }
      if (
        op === 18 ||
        op === 19 ||
        op === 20 ||
        (op >= 178 && op <= 187 && op !== 188) ||
        [189, 192, 193, 197].includes(op)
      )
        suffix += ` // ${ref(op === 18 ? operands.readUInt8() : operands.readUInt16BE())}`
      if ((op >= 153 && op <= 168) || op === 198 || op === 199) suffix += ` -> ${offset + operands.readInt16BE()}`
      if (op === 200 || op === 201) suffix += ` -> ${offset + operands.readInt32BE()}`
      result.push(`${offset}: ${name}${suffix}`)
    }
    return result
  }
  const access = u2()
  const internalName = className(u2()),
    parentIndex = u2()
  const interfacesCount = u2()
  if (interfacesCount > 4096) throw new Error("Class interface count exceeds limit")
  const interfaces = Array.from({ length: interfacesCount }, () => className(u2()))
  const members = (withCode: boolean) => {
    const count = u2()
    if (count > 4096) throw new Error("Class member count exceeds limit")
    return Array.from({ length: count }, () => {
      const access = u2(),
        name = utf8(u2()),
        descriptor = utf8(u2()),
        attrs = attributes()
      const code = attrs.find((attr) => attr.name === "Code")?.data
      if (!withCode) {
        const constant = attrs.find((attr) => attr.name === "ConstantValue")?.data
        if (!constant) return { access, name, descriptor }
        if (constant.length !== 2) throw new Error("Invalid ConstantValue attribute")
        const constantIndex = constant.readUInt16BE(),
          constantEntry = pool[constantIndex]
        if (!constantEntry || ![3, 4, 5, 6, 8].includes(constantEntry.tag))
          throw new Error("Invalid ConstantValue reference")
        return { access, name, descriptor, constant_value: ref(constantIndex) }
      }
      if (!code || (name !== methodName && !options.allMethods)) return { access, name, descriptor }
      if (code.length < 12 || code.readUInt32BE(4) > 65535 || code.readUInt32BE(4) + 12 > code.length)
        throw new Error("Invalid method Code attribute")
      const codeLength = code.readUInt32BE(4),
        lines = instructions(code.subarray(8, 8 + codeLength))
      if (lines.length > maxInstructions) truncated = true
      let cursor = 8 + codeLength
      const exceptionCount = code.readUInt16BE(cursor)
      cursor += 2
      if (exceptionCount > 4096 || cursor + exceptionCount * 8 + 2 > code.length)
        throw new Error("Invalid method exception table")
      const exceptionTable = Array.from({ length: exceptionCount }, () => {
        const start = code.readUInt16BE(cursor),
          end = code.readUInt16BE(cursor + 2),
          handler = code.readUInt16BE(cursor + 4),
          catchIndex = code.readUInt16BE(cursor + 6)
        cursor += 8
        if (start >= end || end > codeLength || handler >= codeLength) throw new Error("Invalid method exception range")
        return { start, end, handler, catch_type: catchIndex ? className(catchIndex) : null }
      })
      const nestedCount = code.readUInt16BE(cursor)
      cursor += 2
      if (nestedCount > 4096) throw new Error("Code attribute count exceeds limit")
      for (let index = 0; index < nestedCount; index++) {
        if (cursor + 6 > code.length) throw new Error("Truncated Code nested attribute")
        utf8(code.readUInt16BE(cursor))
        const length = code.readUInt32BE(cursor + 2)
        cursor += 6 + length
        if (cursor > code.length) throw new Error("Truncated Code nested attribute")
      }
      if (cursor !== code.length) throw new Error("Invalid method Code attribute length")
      return {
        access,
        name,
        descriptor,
        instructions: lines.slice(0, maxInstructions),
        truncated: lines.length > maxInstructions,
        exception_table: exceptionTable,
      }
    })
  }
  const fields = members(false),
    methods = members(true),
    attrs = attributes()
  if (methodName !== undefined && !methods.some((method) => method.name === methodName))
    throw new Error(`Java method not found: ${methodName}`)
  if (position !== bytes.length) throw new Error("Trailing class data")
  const strings = pool.flatMap((entry, index) => (entry.tag === 8 ? [ref(index)] : []))
  const sourceFile = attrs.find((attr) => attr.name === "SourceFile")?.data
  const dynamicRefs = pool.flatMap((entry, index) =>
    [15, 17, 18].includes(entry.tag) ? [{ index, tag: entry.tag, value: ref(index) }] : [],
  )
  const selectedMethods =
    methodName === undefined || options.allMethods ? methods : methods.filter((method) => method.name === methodName)
  const usedBootstraps = new Set(
    selectedMethods
      .flatMap((method) => method.instructions ?? [])
      .flatMap((line) => [...line.matchAll(/bootstrap#(\d+)/g)].map((match) => Number(match[1]))),
  )
  const bootstrapData = attrs.find((attr) => attr.name === "BootstrapMethods")?.data
  const bootstraps: { index: number; method: string; arguments: string[] }[] = []
  if (bootstrapData) {
    let offset = 0
    const read = () => {
      if (offset + 2 > bootstrapData.length) throw new Error("Truncated BootstrapMethods attribute")
      const value = bootstrapData.readUInt16BE(offset)
      offset += 2
      return value
    }
    const count = read()
    if (count > 4096) throw new Error("Bootstrap method count exceeds limit")
    for (let index = 0; index < count; index++) {
      const reference = read(),
        argumentCount = read()
      if (pool[reference]?.tag !== 15 || argumentCount > 4096) throw new Error("Invalid bootstrap method")
      const args = Array.from({ length: argumentCount }, () => ref(read()))
      if (usedBootstraps.has(index)) bootstraps.push({ index, method: ref(reference), arguments: args })
    }
    if (offset !== bootstrapData.length) throw new Error("Invalid BootstrapMethods attribute length")
  }
  if ([...usedBootstraps].some((index) => !bootstraps.some((entry) => entry.index === index)))
    throw new Error("Missing bootstrap method")
  const content = JSON.stringify(
    {
      format: "jvm-static-evidence-v1",
      notice:
        methodName === undefined
          ? "Read-only class signatures and string constants; method bodies are omitted unless a method selector is supplied. Not Java source; not executed or verified by a JVM."
          : "Read-only class structure and selected method disassembly; not Java source, not executed or verified by a JVM. Operand bytes are hexadecimal; // resolves constant pool references. Annotations and debug attributes are omitted.",
      class_version: { major, minor },
      access,
      name: internalName,
      superclass: parentIndex ? className(parentIndex) : null,
      interfaces,
      string_constants: methodName === undefined || options.allMethods ? strings : [],
      fields,
      methods: selectedMethods,
      ...(methodName === undefined
        ? { available_methods: [...new Set(methods.map((method) => method.name))] }
        : { method_name: methodName }),
      dynamic_refs: methodName === undefined ? dynamicRefs : [],
      bootstrap_methods: bootstraps,
      source_file: sourceFile?.length === 2 ? utf8(sourceFile.readUInt16BE()) : null,
    },
    null,
    2,
  )
  if (content.length > 8 * 1024 * 1024) throw new Error("Class evidence output exceeds 8 MiB")
  return { content, truncated }
}
