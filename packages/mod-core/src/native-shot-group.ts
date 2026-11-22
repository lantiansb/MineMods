import type { GenTarget } from "./platform/adapter"

/** Vanilla owns the flight and burst. Only projectiles explicitly attached to a cast share its victim record. */
export function nativeShotGroups(pkg:string,modId:string,target:GenTarget) {
  const root="src/main/java/"+pkg.replaceAll(".","/")
  const old=target.version.minecraft==="1.20.1"
  const files:Record<string,string>={}
  files[root+"/entity/StudioGroupedShot.java"]=`package ${pkg}.entity;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import java.util.*;
public final class StudioGroupedShot {
    private static final Map<Entity, StudioOnce.Group> groups = Collections.synchronizedMap(new WeakHashMap<>());
    public static void attach(Entity shot, StudioOnce.Group group) { groups.put(shot, group); }
    public static StudioOnce.Group group(Entity shot) { return groups.get(shot); }
    public static boolean skip(Entity shot, Entity victim) {
        var group = group(shot);
        return group != null && group.skipEffects() && victim instanceof LivingEntity living && group.seen(living);
    }
}
`
  const prefix=`package ${pkg}.mixin;
import ${pkg}.entity.StudioGroupedShot;
import net.minecraft.world.entity.*;
import net.minecraft.world.entity.projectile.*;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.level.Explosion;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.*;
`
  files[root+"/mixin/StudioShotDamage.java"]=prefix+`@Mixin(LivingEntity.class)
public abstract class StudioShotDamage {
    @Inject(method="hurt", at=@At("HEAD"), cancellable=true)
    private void studioBefore(DamageSource source,float amount,CallbackInfoReturnable<Boolean> result) {
        var group = StudioGroupedShot.group(source.getDirectEntity());
        if (group != null && group.seen((LivingEntity)(Object)this)) result.setReturnValue(!group.skipEffects());
    }
    @Inject(method="hurt", at=@At("RETURN"))
    private void studioAfter(DamageSource source,float amount,CallbackInfoReturnable<Boolean> result) {
        var group = StudioGroupedShot.group(source.getDirectEntity());
        if (group != null && result.getReturnValue()) group.mark((LivingEntity)(Object)this);
    }
}
`
  files[root+"/mixin/StudioShotCollision.java"]=prefix+`@Mixin(Projectile.class)
public abstract class StudioShotCollision {
    @Inject(method="canHitEntity", at=@At("HEAD"), cancellable=true)
    private void studioMayHit(Entity victim,CallbackInfoReturnable<Boolean> result) {
        if (StudioGroupedShot.skip((Entity)(Object)this,victim)) result.setReturnValue(false);
    }
}
`
  files[root+"/mixin/StudioShotBlast.java"]=prefix+`@Mixin(Explosion.class)
public abstract class StudioShotBlast {
    @Redirect(method="explode",at=@At(value="INVOKE",target="Lnet/minecraft/world/entity/Entity;ignoreExplosion(${old?"":"Lnet/minecraft/world/level/Explosion;"})Z"))
    private boolean studioSkipBlast(Entity victim${old?"":", Explosion explosion"}) {
        var blast=(Explosion)(Object)this;
        return StudioGroupedShot.skip(blast.getDirectSourceEntity(),victim) || victim.ignoreExplosion(${old?"":"explosion"});
    }
}
`
  files[root+"/mixin/StudioShotSnow.java"]=prefix+`@Mixin(Snowball.class)
public abstract class StudioShotSnow {
    @Inject(method="onHitEntity",at=@At("RETURN"))
    private void studioTouch(net.minecraft.world.phys.EntityHitResult hit, CallbackInfo callback) {
        var group=StudioGroupedShot.group((Entity)(Object)this);
        if(group!=null && hit.getEntity() instanceof LivingEntity living) group.mark(living);
    }
}
`
  return {files,patch:{[`src/main/resources/${modId}.mixins.json`]:(s:string)=>target.loader.addMixins(s,{common:["StudioShotDamage","StudioShotCollision","StudioShotBlast","StudioShotSnow"]})}}
}
