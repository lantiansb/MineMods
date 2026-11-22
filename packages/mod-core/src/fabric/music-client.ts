import { musicEvents, type MusicDocument } from "../music"

export function musicClient(packageName: string, songs: { document: MusicDocument }[]) {
  const tracks = songs.map(({ document }) => {
    const parts = musicEvents(document)
    const event = (key: string) => {
      const part = parts.find(part => part.part === key)
      return part ? "StudioSounds.SOUND_" + part.event.toUpperCase() : "null"
    }
    return `new Track(${event("intro")}, ${event("loop")}, ${event("outro")}, ${Math.ceil((document.intro?.seconds ?? 0) * 20)})`
  })
  return `package ${packageName}.entity;

import ${packageName}.StudioSounds;
import ${packageName}.platform.StudioClientPlatform;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.resources.sounds.AbstractTickableSoundInstance;
import net.minecraft.client.resources.sounds.SoundInstance;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundSource;

public final class StudioMusicClient {
    private record Track(SoundEvent intro, SoundEvent loop, SoundEvent outro, int introTicks) {}
    private static final Track[] TRACKS = {${tracks.join(",\n        ")}};
    private static ClientLevel world;
    private static int song = -1;
    private static Voice voice;
    private static Voice ending;
    private static boolean intro;
    private static int remaining;
    private static int fade;

    private static final class Voice extends AbstractTickableSoundInstance {
        Voice(SoundEvent event, boolean repeat) {
            super(event, SoundSource.MUSIC, SoundInstance.createUnseededRandom());
            relative = true;
            attenuation = SoundInstance.Attenuation.NONE;
            looping = repeat;
        }
        @Override public void tick() {}
        void gain(float value) { volume = value; }
    }

    public static void register() {
        StudioClientPlatform.onS2C(StudioMusic.CHANNEL, StudioMusicClient::receive);
        StudioClientPlatform.onClientTick(StudioMusicClient::tick);
    }

    private static Voice play(SoundEvent event, boolean repeat) {
        Voice instance = new Voice(event, repeat);
        Minecraft.getInstance().getSoundManager().play(instance);
        return instance;
    }

    private static void clear() {
        var sounds = Minecraft.getInstance().getSoundManager();
        if (voice != null) sounds.stop(voice);
        if (ending != null) sounds.stop(ending);
        voice = null;
        ending = null;
        song = -1;
        world = null;
        intro = false;
        remaining = 0;
    }

    private static void receive(StudioMusic.Cue cue) {
        var game = Minecraft.getInstance();
        if (cue.song() < 0 || cue.song() >= TRACKS.length || game.level == null) return;
        Track track = TRACKS[cue.song()];
        if (cue.action() == 0) {
            clear();
            world = game.level;
            song = cue.song();
            intro = track.intro != null && cue.elapsed() < track.introTicks;
            game.getMusicManager().stopPlaying();
            voice = play(intro ? track.intro : track.loop, !intro);
        } else if (song == cue.song() && (cue.action() == 1 || cue.action() == 2)) {
            intro = false;
            fade = remaining = cue.fade();
            if (remaining == 0 && voice != null) {
                voice.gain(0);
                game.getSoundManager().stop(voice);
                voice = null;
            }
            if (cue.action() == 2 && track.outro != null && ending == null) ending = play(track.outro, false);
        }
    }

    private static void tick() {
        if (song < 0) return;
        var game = Minecraft.getInstance();
        if (game.level != world) { clear(); return; }
        if (game.isPaused()) return;
        var sounds = game.getSoundManager();
        game.getMusicManager().stopPlaying();
        if (remaining > 0 && voice != null) {
            voice.gain((float) --remaining / fade);
            if (remaining == 0) {
                sounds.stop(voice);
                voice = null;
            }
        } else if (intro && !sounds.isActive(voice)) {
            intro = false;
            voice = play(TRACKS[song].loop, true);
        }
        if (ending != null && !sounds.isActive(ending)) ending = null;
        if (voice == null && ending == null) clear();
    }
}
`
}
