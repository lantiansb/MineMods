import { z } from "zod"
import type { Ability } from "./entity-runtime"

export const onceFields = {
  once_group: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "命中组名用小写字母开头，最多 32 个小写字母、数字或下划线。").optional(),
  once_skip_effects: z.boolean().optional(),
  once_across_steps: z.boolean().optional(),
}
type Member = { once_group?: string; once_skip_effects?: boolean; once_across_steps?: boolean }
export function hasOnce(ability: Pick<Ability,"events"|"hits">) {
  return [...ability.hits,...ability.events].some(member => "once_group" in member && !!member.once_group)
}
export function onceIssues(entries: readonly unknown[], key: string) {
  return entries.flatMap((member,i) => {
    const value = member as Member
    return !value.once_group && (value.once_skip_effects !== undefined || value.once_across_steps !== undefined) ? [{ path:[key,i,"once_group"], message:"先填命中组名，再设置重复命中或跨步共用。" }] : []
  })
}
export function onceRef(member: Member) {
  return member.once_group ? `onceHits.group(${JSON.stringify(member.once_group)}, ${!!member.once_across_steps}, ${member.once_skip_effects !== false})` : null
}
// Read before applying damage and record only after a successful strike. Secondary effects use the same success path.
export function onceStrike(member: Member, statement: string) {
  const ref = onceRef(member)
  if (!ref) return [statement]
  return [`    var group = ${ref};`, "    boolean repeat = group.seen(victim);", "    if (repeat && group.skipEffects()) continue;",
    statement.replace(/(abilityStrike(?:At)?\(victim, )/, "$1repeat ? 0.0f : "), "    group.mark(victim);"]
}
export function onceJava(pkg: string) {
  return {[`src/main/java/${pkg.replaceAll(".","/")}/entity/StudioOnce.java`]: `package ${pkg}.entity;
import net.minecraft.world.entity.LivingEntity;
import java.util.*;
public final class StudioOnce {
    public record Group(Set<UUID> victims, boolean skipEffects) {
        public boolean seen(LivingEntity target) { return victims.contains(target.getUUID()); }
        public void mark(LivingEntity target) { victims.add(target.getUUID()); }
    }
    private final Map<String,Set<UUID>> step = new HashMap<>(), combo = new HashMap<>();
    public Group group(String name, boolean across, boolean skipEffects) {
        return new Group((across ? combo : step).computeIfAbsent(name, key -> new HashSet<>()), skipEffects);
    }
    public void nextCast() { step.clear(); combo.clear(); }
    public void nextStep() { step.clear(); }
}
`}
}
