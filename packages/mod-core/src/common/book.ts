import { z } from "zod"
import type { GenTarget } from "../platform/adapter"
import { PLATFORM_CLASS, PLATFORM_PACKAGE } from "../platform/facade"
import { BOOK_DEFAULT_COLOR, BOOK_FRAME_CLEAR, BOOK_IMAGE_LINES, BOOK_INK, BOOK_PAGE, BOOK_TEXT_BOXES, bookInks, coverInk, marginScale, pageText, textureTone, type BookDocument, type BookTexture } from "../book"
import { encodePng } from "../png"

/** The classes a book is made of, in `<package>.book`. */
export const BOOK_RUNTIME = { server: "StudioBooks", item: "StudioBookItem", client: "StudioBookClient", screen: "StudioBookScreen" } as const
/** A book's registry name: the item, its language keys and the tags a player carries for it. */
import { bookName } from "../registry-name"
export { bookName }

export type BookCompileInput = {
  modId: string
  packageName: string
  books: readonly { id: string; title: string; document: BookDocument }[]
  /** The PNG of each picture a book shows (its pages' and its look's), by texture asset id, with its size and, for a look's, its pixels. */
  pictures: Readonly<Record<string, { png: Uint8Array; width: number; height: number; texture?: BookTexture }>>
}

const hex = (color: string) => `0xFF${color.slice(1).toUpperCase()}`
const shade = (color: string, by: number) => `#${[1, 3, 5].map((at) => Math.max(0, Math.min(255, Math.round(parseInt(color.slice(at, at + 2), 16) * by))).toString(16).padStart(2, "0")).join("")}`
const quoted = (text: string) => JSON.stringify(text)

/** The item's 16×16 picture: a closed book in the cover's colour, its spine darker and its pages showing below. */
const ICON = [
  "................",
  "..DDDDDDDDDDD...",
  "..DSCCCCCCCCCD..",
  "..DSCPPPPPPCCD..",
  "..DSCPCCCCPCCD..",
  "..DSCPPPPPPCCD..",
  "..DSCCCCCCCCCD..",
  "..DSCCCCCCCCCD..",
  "..DSCCCCCCCCCD..",
  "..DSCCCCCCCCCD..",
  "..DSCCCCCCCCCD..",
  "..DSCCCCCCCCCD..",
  "..DSCCCCCCCCCDP.",
  "..DSDDDDDDDDDDP.",
  "...DPPPPPPPPPPW.",
  "....WWWWWWWWWW..",
]
export function bookIcon(color: string) {
  const colours: Record<string, string> = { D: shade(color, 0.5), S: shade(color, 0.72), C: color, P: "#efe6cf", W: "#c9bc98" }
  const pixels = new Uint8Array(16 * 16 * 4)
  ICON.forEach((row, y) => [...row].forEach((cell, x) => {
    const at = (y * 16 + x) * 4
    if (cell === ".") return
    const value = colours[cell]!
    pixels.set([parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16), 255], at)
  }))
  return encodePng(pixels, 16, 16)
}

/** A frame's or an icon's PNG: its see-through colour drawn transparent, so what is under it shows through. */
export function framePng(texture: BookTexture, clear: string) {
  const pixels = new Uint8Array(texture.width * texture.height * 4)
  const skip = clear.toLowerCase()
  texture.pixels.forEach((index, at) => {
    const color = texture.palette[index]!.toLowerCase()
    if (color === skip) return
    pixels.set([parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), 255], at * 4)
  })
  return encodePng(pixels, texture.width, texture.height)
}

/**
 * Whether the screen is the one r28 generated: every book asks for the small margin note and none has a look. Then the source is r28's text
 * byte for byte; otherwise the screen reads each book's own note scale, inks and pictures from per-book tables.
 */
export const plainBooks = (books: readonly { document: BookDocument }[]) => books.every((book) => book.document.margin_small && !book.document.look)

const Input = z.object({ modId: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/), packageName: z.string().regex(/^[a-z][a-z0-9_.]*$/) })

/**
 * 书 on every target: the same common code (vanilla classes in Mojang's names, mapped to the game version by `rewriteJava`), reaching the loader
 * through the facade on Forge and NeoForge and through Fabric API on Fabric (its build keeps its own text, so a project without books is untouched).
 *
 * - Each book is an item that opens the mod's own page screen when used (`StudioBookItem.use` on the player's side asks `StudioBooks.open`, which only
 *   the client entry sets, so a server never loads a screen class).
 * - The first time a player joins a world, each book that says so is put in their inventory and a tag is put on the player
 *   (`<mod id>.<book>.given`): the game saves a player's tags with the player and copies them when the player respawns, so a rejoin gives nothing and another world gives again.
 * - Just before a player dies (Fabric API's ALLOW_DEATH; Forge's and NeoForge's death event, which fires before anything drops), a book that is kept on death is
 *   taken out of the inventory and counted on a tag (`<mod id>.<book>.kept.<n>`); once the player is alive again (the respawned player, or one whose death was called off),
 *   that many are put back. A count rather than the stacks: a book's pages are the item's own, so a new one is the same book.
 * - Its words are language keys: `zh_cn` has the Chinese, `en_us` the English where it is written and the Chinese where it is not, which is what a game in any
 *   other language falls back to.
 */
export function compileBooks(value: BookCompileInput, target: GenTarget) {
  const { modId, packageName } = { ...value, ...Input.parse(value) }
  const facade = target.loader.facade
  const version = target.version
  const books = [...value.books].sort((left, right) => left.id.localeCompare(right.id))
  const names = books.map((book) => bookName(book))
  const source = `src/main/java/${packageName.replaceAll(".", "/")}/book`
  const resources = `src/main/resources/assets/${modId}`
  const plain = plainBooks(books)
  const looks = books.map((book) => book.document.look)
  const pictures = [...new Set(books.flatMap((book, at) => [...book.document.pages.flatMap((page) => (page.image ? [page.image] : [])), ...[looks[at]?.cover, looks[at]?.paper, looks[at]?.paper_even].filter((id): id is string => !!id)]))].sort()
  const picture = (id: string) => `textures/gui/book/${id.replaceAll("-", "")}.png`
  // A frame, with the colour drawn see-through in its name: one texture may be the frame of two books that clear different colours.
  const clearOf = (at: number) => (looks[at]?.clear_color ?? BOOK_FRAME_CLEAR).toLowerCase()
  const frames = [...new Set(books.flatMap((_, at) => (looks[at]?.frame ? [`${looks[at]!.frame}|${clearOf(at)}`] : [])))].sort()
  const frameId = (key: string) => key.split("|")[0]!
  const frameFile = (key: string) => `textures/gui/book/${frameId(key).replaceAll("-", "")}_${key.split("|")[1]!.slice(1)}.png`
  const frameOf = (at: number) => (looks[at]?.frame ? frames.indexOf(`${looks[at]!.frame}|${clearOf(at)}`) : -1)
  const art = (id: string | undefined) => (id ? pictures.indexOf(id) : -1)
  const textureOf = (id: string) => {
    const texture = value.pictures[id]?.texture
    if (!texture) throw new Error(`BOOK_LOOK_TEXTURE_MISSING:${id}`)
    return texture
  }
  // The cover's ink: from its colour, or from the picture under its title when it has one.
  const coverInkOf = (at: number) => coverInk(looks[at]?.cover ? (textureTone(textureOf(looks[at]!.cover!), BOOK_TEXT_BOXES.cover_title) ?? BOOK_INK.paper) : (books[at]!.document.cover_color ?? BOOK_DEFAULT_COLOR))
  const location = (path: string) => version.resourceLocation(quoted(modId), quoted(path))
  const list = (items: readonly (string | number | boolean)[]) => `{${items.join(", ")}}`
  const server = `package ${packageName}.book;

${facade ? `import ${packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS};
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
` : `import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
`}import java.util.function.IntConsumer;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;

/** Generated by MineMods Studio: this mod's books, given once per player and world, kept on death, read on {@link ${BOOK_RUNTIME.screen}}. */
public final class ${BOOK_RUNTIME.server}${facade ? "" : " implements ModInitializer"} {
    public static final String MOD_ID = ${quoted(modId)};
    static final String[] NAMES = ${list(names.map(quoted))};
    private static final boolean[] GIVE = ${list(books.map((book) => book.document.give_on_first_join))};
    private static final boolean[] KEEP = ${list(books.map((book) => book.document.keep_on_death))};
${facade ? "    private static final List<Supplier<? extends Item>> ITEMS = new ArrayList<>();" : "    private static final Item[] ITEMS = new Item[NAMES.length];"}
    /** What using a book does on the player's side: set by the client entry, nothing on a server. */
    public static volatile IntConsumer opener = book -> {};

${facade ? `    private ${BOOK_RUNTIME.server}() {}
` : `
    @Override public void onInitialize() { register(); }
`}
    public static void register() {
        for (int book = 0; book < NAMES.length; book++) {
            int which = book;
${facade ? `            Supplier<? extends Item> item = ${PLATFORM_CLASS}.item(NAMES[book], () -> new ${BOOK_RUNTIME.item}(new Item.Properties().stacksTo(1), which));
            ITEMS.add(item);
            ${PLATFORM_CLASS}.addToTab(CreativeModeTabs.TOOLS_AND_UTILITIES, item);
        }
        ${PLATFORM_CLASS}.onPlayerJoin(${BOOK_RUNTIME.server}::joined);
        ${PLATFORM_CLASS}.onEntityDeath((entity, damage) -> { if (entity instanceof ServerPlayer player) dying(player); });
        ${PLATFORM_CLASS}.onServerTick(${BOOK_RUNTIME.server}::tick);` : `            ITEMS[book] = Registry.register(BuiltInRegistries.ITEM, ${version.resourceLocation("MOD_ID", "NAMES[book]")}, new ${BOOK_RUNTIME.item}(new Item.Properties().stacksTo(1), which));
        }
        ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.TOOLS_AND_UTILITIES).register(entries -> { for (Item item : ITEMS) entries.accept(item); });
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> joined(handler.player));
        ServerLivingEntityEvents.ALLOW_DEATH.register((entity, damage, amount) -> {
            if (entity instanceof ServerPlayer player) dying(player);
            return true;
        });
        ServerTickEvents.END_SERVER_TICK.register(${BOOK_RUNTIME.server}::tick);`}
    }

    public static Item item(int book) { return ITEMS${facade ? ".get(book).get()" : "[book]"}; }

    static void open(int book) { opener.accept(book); }

    private static String given(int book) { return MOD_ID + "." + NAMES[book] + ".given"; }

    private static String kept(int book) { return MOD_ID + "." + NAMES[book] + ".kept."; }

    static void joined(ServerPlayer player) {
        for (int book = 0; book < NAMES.length; book++) if (GIVE[book] && player.addTag(given(book))) give(player, book, 1);
    }

    static void dying(ServerPlayer player) {
        Inventory inventory = player.getInventory();
        for (int book = 0; book < NAMES.length; book++) {
            if (!KEEP[book]) continue;
            int count = taken(player, book);
            for (int slot = 0; slot < inventory.getContainerSize(); slot++) {
                ItemStack stack = inventory.getItem(slot);
                if (!stack.is(item(book))) continue;
                count += stack.getCount();
                inventory.setItem(slot, ItemStack.EMPTY);
            }
            if (count > 0) player.addTag(kept(book) + count);
        }
    }

    /** The count a tag holds for this book, the tag taken off. */
    private static int taken(ServerPlayer player, int book) {
        String prefix = kept(book);
        for (String tag : player.getTags()) {
            if (!tag.startsWith(prefix)) continue;
            player.removeTag(tag);
            return Integer.parseInt(tag.substring(prefix.length()));
        }
        return 0;
    }

    private static void tick(MinecraftServer server) {
        if (server.getTickCount() % 10 != 0) return;
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            if (!player.isAlive()) continue;
            for (int book = 0; book < NAMES.length; book++) {
                int count = KEEP[book] ? taken(player, book) : 0;
                if (count > 0) give(player, book, count);
            }
        }
    }

    private static void give(ServerPlayer player, int book, int count) {
        for (int made = 0; made < count; made++) {
            ItemStack stack = new ItemStack(item(book));
            if (!player.getInventory().add(stack)) player.drop(stack, false);
        }
    }
}
`
  const item = `package ${packageName}.book;

import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;

/** One of this mod's books: using it opens its pages on the player's side. */
public final class ${BOOK_RUNTIME.item} extends Item {
    private final int book;

    public ${BOOK_RUNTIME.item}(Item.Properties properties, int book) {
        super(properties);
        this.book = book;
    }

    @Override
    public InteractionResultHolder<ItemStack> use(Level level, Player player, InteractionHand hand) {
        if (level.isClientSide()) ${BOOK_RUNTIME.server}.open(book);
        return InteractionResultHolder.sidedSuccess(player.getItemInHand(hand), level.isClientSide());
    }
}
`
  const client = `package ${packageName}.book;

import net.minecraft.client.Minecraft;

/** A player's game: using a book opens its screen. */
public final class ${BOOK_RUNTIME.client}${facade ? "" : " implements net.fabricmc.api.ClientModInitializer"} {
${facade ? "" : "    @Override public void onInitializeClient() { register(); }\n\n"}    public static void register() {
        ${BOOK_RUNTIME.server}.opener = book -> Minecraft.getInstance().setScreen(new ${BOOK_RUNTIME.screen}(book));
    }
}
`
  const p = BOOK_PAGE
  const screen = `package ${packageName}.book;

${plain ? "" : "import com.mojang.blaze3d.systems.RenderSystem;\n"}import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.util.FormattedCharSequence;

/**
 * A book's pages, one at a time: the cover first, then each page with its title, its picture, its text and the note at its foot. Left and right (the
 * arrows beside the page, the arrow keys, Page Up and Page Down) turn the page. Laid out with the numbers the Studio check measures against (book.ts).
 */
public final class ${BOOK_RUNTIME.screen} extends Screen {
    private static final int WIDTH = ${p.panel.width}, HEIGHT = ${p.panel.height}, LEFT = ${p.text.left}, TEXT = ${p.text.width}, LINE = ${p.line};
    private static final int TITLE_TOP = ${p.title_top}, BODY_TOP = ${p.body_top}, BODY_LINES = ${p.body_lines}, IMAGE_LINES = ${BOOK_IMAGE_LINES};
    private static final int IMAGE_WIDTH = ${p.image.width}, IMAGE_HEIGHT = ${p.image.height}, IMAGE_GAP = ${p.image.gap};
${plain ? `    private static final int MARGIN_TOP = ${p.margin.top}, MARGIN_LINES = ${p.margin.lines}, NUMBER_TOP = ${p.number_top_small};
    private static final float MARGIN_SCALE = ${p.margin.small}f;
` : `    private static final int MARGIN_TOP = ${p.margin.top}, MARGIN_LINES = ${p.margin.lines};
    /** Per book: the scale of its margin notes, and where its page number is (lower when the notes are full size). */
    private static final float[] MARGIN_SCALE = ${list(books.map((book) => `${marginScale(book.document)}f`))};
    private static final int[] NUMBER_TOP = ${list(books.map((book) => (book.document.margin_small ? p.number_top_small : p.number_top)))};
`}    private static final int COVER_TITLE_TOP = ${p.cover.title_top}, COVER_WRAP = ${p.cover.wrap}, COVER_LINES = ${p.cover.lines}, AUTHOR_TOP = ${p.cover.author_top};
${plain ? `    private static final int PAPER = 0xFFF4EBD3, INK = 0xFF2B2118, HEADING = 0xFF4A2F1A, FAINT = 0xFF8A7A66;
` : `    private static final int PAPER = ${hex(BOOK_INK.paper)};
    /** Per book: the ink of its text, its page titles and its margin notes. */
    private static final int[] INK = ${list(books.map((book) => hex(bookInks(book.document.look).body)))};
    private static final int[] HEADING = ${list(books.map((book) => hex(bookInks(book.document.look).title)))};
    private static final int[] FAINT = ${list(books.map((book) => hex(bookInks(book.document.look).margin)))};
    /** Per book: the pictures of its cover, its odd and its even pages (in PICTURES, -1 drawn plain), and its frame (in FRAMES, -1 none). */
    private static final int[] COVER_ART = ${list(looks.map((look) => art(look?.cover)))};
    private static final int[] PAPER_ODD = ${list(looks.map((look) => art(look?.paper)))};
    private static final int[] PAPER_EVEN = ${list(looks.map((look) => art(look?.paper_even ?? look?.paper)))};
    private static final int[] FRAME = ${list(books.map((_, at) => frameOf(at)))};
    /** Per book: false when its cover picture has the title drawn in, so neither the title nor the author is printed on it. */
    private static final boolean[] COVER_TITLE = ${list(looks.map((look) => !look?.title_in_cover))};
    private static final ResourceLocation[] FRAMES = ${list(frames.map((key) => location(frameFile(key))))};
    private static final int[][] FRAME_SIZE = ${list(frames.map((key) => list([value.pictures[frameId(key)]!.width, value.pictures[frameId(key)]!.height])))};
`}    private static final int[] PAGES = ${list(books.map((book) => book.document.pages.length))};
    private static final int[] COVER = ${list(books.map((book) => hex(book.document.cover_color ?? BOOK_DEFAULT_COLOR)))};
    private static final int[] EDGE = ${list(books.map((book) => hex(shade(book.document.cover_color ?? BOOK_DEFAULT_COLOR, 0.55))))};
    private static final int[] COVER_INK = ${list(books.map((_, at) => hex(coverInkOf(at))))};
    private static final boolean[] AUTHOR = ${list(books.map((book) => Boolean(book.document.author)))};
    /** Per page: 1 it has a title, 2 a note at its foot. */
    private static final int[][] PARTS = ${list(books.map((book) => list(book.document.pages.map((page) => (page.title ? 1 : 0) | (page.margin ? 2 : 0)))))};
    /** Per page: which picture it shows, -1 none. */
    private static final int[][] IMAGE = ${list(books.map((book) => list(book.document.pages.map((page) => (page.image ? pictures.indexOf(page.image) : -1)))))};
    private static final ResourceLocation[] PICTURES = ${list(pictures.map((id) => location(picture(id))))};
    private static final int[][] PICTURE_SIZE = ${list(pictures.map((id) => list([value.pictures[id]!.width, value.pictures[id]!.height])))};

    private final int book;
    private int page;

    public ${BOOK_RUNTIME.screen}(int book) {
        super(Component.translatable("item." + ${BOOK_RUNTIME.server}.MOD_ID + "." + ${BOOK_RUNTIME.server}.NAMES[book]));
        this.book = book;
    }

    /** The page shown: 0 the cover, then 1 to the number of pages. */
    public int page() { return page; }

    public void show(int page) {
        int next = Math.max(0, Math.min(PAGES[book], page));
        if (next == this.page) return;
        this.page = next;
        Minecraft.getInstance().getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.BOOK_PAGE_TURN, 1.0F));
    }

    private Component words(int page, String part) {
        return Component.translatable("book." + ${BOOK_RUNTIME.server}.MOD_ID + "." + ${BOOK_RUNTIME.server}.NAMES[book] + "." + page + "." + part);
    }

    private int left() { return (width - WIDTH) / 2; }

    private int top() { return (height - HEIGHT) / 2; }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        graphics.fill(0, 0, width, height, 0xB0101010);
        int x = left(), y = top();
        if (page == 0) cover(graphics, x, y);
        else sheet(graphics, x, y, page);
        if (page > 0) arrow(graphics, "<", x - 22, y + HEIGHT / 2 - 8, mouseX, mouseY);
        if (page < PAGES[book]) arrow(graphics, ">", x + WIDTH + 6, y + HEIGHT / 2 - 8, mouseX, mouseY);
    }

    private void arrow(GuiGraphics graphics, String sign, int x, int y, int mouseX, int mouseY) {
        boolean over = mouseX >= x && mouseX < x + 16 && mouseY >= y && mouseY < y + 16;
        graphics.pose().pushPose();
        graphics.pose().translate(x + 4, y, 0);
        graphics.pose().scale(2.0F, 2.0F, 1.0F);
        graphics.drawString(font, sign, 0, 0, over ? 0xFFFFE9A8 : 0xFFE8DCC0, true);
        graphics.pose().popPose();
    }

    private void cover(GuiGraphics graphics, int x, int y) {
        int ink = COVER_INK[book];
${plain ? `        graphics.fill(x, y, x + WIDTH, y + HEIGHT, EDGE[book]);
        graphics.fill(x + 4, y + 4, x + WIDTH - 4, y + HEIGHT - 4, COVER[book]);
        graphics.fill(x + 12, y + 4, x + 14, y + HEIGHT - 4, EDGE[book]);
        graphics.fill(x + 24, y + 18, x + WIDTH - 18, y + 19, ink);
        graphics.fill(x + 24, y + HEIGHT - 19, x + WIDTH - 18, y + HEIGHT - 18, ink);
` : `        if (COVER_ART[book] >= 0) whole(graphics, COVER_ART[book], x, y);
        else {
            graphics.fill(x, y, x + WIDTH, y + HEIGHT, EDGE[book]);
            graphics.fill(x + 4, y + 4, x + WIDTH - 4, y + HEIGHT - 4, COVER[book]);
            graphics.fill(x + 12, y + 4, x + 14, y + HEIGHT - 4, EDGE[book]);
            graphics.fill(x + 24, y + 18, x + WIDTH - 18, y + 19, ink);
            graphics.fill(x + 24, y + HEIGHT - 19, x + WIDTH - 18, y + HEIGHT - 18, ink);
        }
        if (!COVER_TITLE[book]) return;
`}        List<FormattedCharSequence> lines = font.split(title, COVER_WRAP);
        int middle = x + 7 + WIDTH / 2;
        graphics.pose().pushPose();
        graphics.pose().translate(middle, y + COVER_TITLE_TOP, 0);
        graphics.pose().scale(2.0F, 2.0F, 1.0F);
        for (int line = 0; line < Math.min(COVER_LINES, lines.size()); line++)
            graphics.drawString(font, lines.get(line), -font.width(lines.get(line)) / 2, line * (LINE + 1), ink, false);
        graphics.pose().popPose();
        if (AUTHOR[book]) {
            Component author = Component.translatable("book." + ${BOOK_RUNTIME.server}.MOD_ID + "." + ${BOOK_RUNTIME.server}.NAMES[book] + ".author");
            graphics.drawString(font, author, middle - font.width(author) / 2, y + AUTHOR_TOP, ink, false);
        }
    }

    private void sheet(GuiGraphics graphics, int x, int y, int page) {
        int parts = PARTS[book][page - 1], image = IMAGE[book][page - 1];
${plain ? `        graphics.fill(x, y, x + WIDTH, y + HEIGHT, EDGE[book]);
        graphics.fill(x + 3, y + 3, x + WIDTH - 3, y + HEIGHT - 3, PAPER);
` : `        int paper = page % 2 == 0 ? PAPER_EVEN[book] : PAPER_ODD[book];
        if (paper >= 0) whole(graphics, paper, x, y);
        else {
            graphics.fill(x, y, x + WIDTH, y + HEIGHT, EDGE[book]);
            graphics.fill(x + 3, y + 3, x + WIDTH - 3, y + HEIGHT - 3, PAPER);
        }
        if (FRAME[book] >= 0) {
            // Its see-through colour was made transparent when the mod was built; blending keeps the paper under it.
            int[] size = FRAME_SIZE[FRAME[book]];
            RenderSystem.enableBlend();
            graphics.blit(FRAMES[FRAME[book]], x, y, WIDTH, HEIGHT, 0.0F, 0.0F, size[0], size[1], size[0], size[1]);
            RenderSystem.disableBlend();
        }
`}        int left = x + LEFT;
        if ((parts & 1) != 0) graphics.drawString(font, words(page, "title"), left, y + TITLE_TOP, HEADING${plain ? "" : "[book]"}, false);
        int body = y + BODY_TOP;
        if (image >= 0) {
            int[] size = PICTURE_SIZE[image];
            graphics.blit(PICTURES[image], left + (TEXT - IMAGE_WIDTH) / 2, body, IMAGE_WIDTH, IMAGE_HEIGHT, 0.0F, 0.0F, size[0], size[1], size[0], size[1]);
            body += IMAGE_HEIGHT + IMAGE_GAP;
        }
        List<FormattedCharSequence> lines = font.split(words(page, "body"), TEXT);
        for (int line = 0; line < lines.size(); line++) graphics.drawString(font, lines.get(line), left, body + line * LINE, INK${plain ? "" : "[book]"}, false);
        if ((parts & 2) != 0) {
            List<FormattedCharSequence> notes = font.split(words(page, "margin"), (int) (TEXT / MARGIN_SCALE${plain ? "" : "[book]"}));
            graphics.pose().pushPose();
            graphics.pose().translate(left, y + MARGIN_TOP, 0);
            graphics.pose().scale(MARGIN_SCALE${plain ? "" : "[book]"}, MARGIN_SCALE${plain ? "" : "[book]"}, 1.0F);
            for (int line = 0; line < notes.size(); line++) graphics.drawString(font, notes.get(line), 0, line * LINE, FAINT${plain ? "" : "[book]"}, false);
            graphics.pose().popPose();
        }
        String number = page + " / " + PAGES[book];
        graphics.drawString(font, number, x + WIDTH / 2 - font.width(number) / 2, y + NUMBER_TOP${plain ? "" : "[book]"}, FAINT${plain ? "" : "[book]"}, false);
    }
${plain ? "" : `
    /** A picture over the whole panel (a cover or a page's paper), stretched to it. */
    private void whole(GuiGraphics graphics, int picture, int x, int y) {
        int[] size = PICTURE_SIZE[picture];
        graphics.blit(PICTURES[picture], x, y, WIDTH, HEIGHT, 0.0F, 0.0F, size[0], size[1], size[0], size[1]);
    }
`}
    @Override
    public boolean keyPressed(int key, int scanCode, int modifiers) {
        // GLFW: right, left, page down, page up.
        if (key == 262 || key == 267) { show(page + 1); return true; }
        if (key == 263 || key == 266) { show(page - 1); return true; }
        return super.keyPressed(key, scanCode, modifiers);
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        int middle = top() + HEIGHT / 2 - 8;
        if (button == 0 && mouseY >= middle && mouseY < middle + 16) {
            if (page > 0 && mouseX >= left() - 22 && mouseX < left() - 6) { show(page - 1); return true; }
            if (page < PAGES[book] && mouseX >= left() + WIDTH + 6 && mouseX < left() + WIDTH + 22) { show(page + 1); return true; }
        }
        return super.mouseClicked(mouseX, mouseY, button);
    }
}
`
  const files: Record<string, string | Uint8Array> = {
    [`${source}/${BOOK_RUNTIME.server}.java`]: version.rewriteJava(server),
    [`${source}/${BOOK_RUNTIME.item}.java`]: version.rewriteJava(item),
    [`${source}/${BOOK_RUNTIME.client}.java`]: version.rewriteJava(client),
    [`${source}/${BOOK_RUNTIME.screen}.java`]: version.rewriteJava(screen),
    ...Object.fromEntries(books.flatMap((book) => [
      [`${resources}/models/item/${bookName(book)}.json`, JSON.stringify({ parent: "minecraft:item/generated", textures: { layer0: `${modId}:item/${bookName(book)}` } }, null, 2)],
      [`${resources}/textures/item/${bookName(book)}.png`, book.document.look?.icon ? framePng(textureOf(book.document.look.icon), book.document.look.clear_color ?? BOOK_FRAME_CLEAR) : bookIcon(book.document.cover_color ?? BOOK_DEFAULT_COLOR)],
    ])),
    ...Object.fromEntries(pictures.map((id) => [`${resources}/${picture(id)}`, value.pictures[id]!.png])),
    ...Object.fromEntries(frames.map((key) => [`${resources}/${frameFile(key)}`, framePng(textureOf(frameId(key)), `#${key.split("|")[1]!.slice(1)}`)])),
  }
  const words = (language: "zh" | "en") => Object.fromEntries(books.flatMap((book) => {
    const key = `book.${modId}.${bookName(book)}`
    return [
      [`item.${modId}.${bookName(book)}`, (language === "en" ? book.document.name_en : undefined) ?? book.document.name],
      ...(book.document.author ? [[`${key}.author`, book.document.author]] : []),
      ...book.document.pages.flatMap((page, index) => {
        const text = pageText(page, language)
        return [
          ...(page.title ? [[`${key}.${index + 1}.title`, text.title]] : []),
          [`${key}.${index + 1}.body`, text.body],
          ...(page.margin ? [[`${key}.${index + 1}.margin`, text.margin]] : []),
        ]
      }),
    ]
  }))
  return {
    files,
    language: { zh_cn: words("zh"), en_us: words("en") },
    /** Paths inside the built jar that prove the books went in. */
    classes: [`${packageName.replaceAll(".", "/")}/book/${BOOK_RUNTIME.server}.class`, `${packageName.replaceAll(".", "/")}/book/${BOOK_RUNTIME.screen}.class`],
    /** For the build record: every book with its registry name. */
    manifest: books.map((book) => ({ id: book.id, title: book.title, name: bookName(book), pages: book.document.pages.length })),
    /** Fabric: the two classes are entry points of fabric.mod.json. */
    patch: (facade
      ? {}
      : {
          "src/main/resources/fabric.mod.json": (text: string) => {
            const metadata = z.record(z.string(), z.unknown()).parse(JSON.parse(text))
            const entrypoints = z.looseObject({ main: z.array(z.string()), client: z.array(z.string()).default([]) }).parse(metadata.entrypoints)
            const edited = `${JSON.stringify({ ...metadata, entrypoints: { ...entrypoints, main: [...entrypoints.main, `${packageName}.book.${BOOK_RUNTIME.server}`], client: [...entrypoints.client, `${packageName}.book.${BOOK_RUNTIME.client}`] } }, null, 2)}\n`
            return text.includes("\r\n") ? edited.replaceAll("\n", "\r\n") : edited
          },
        }) as Record<string, (text: string) => string>,
    /** A facade target: the two classes whose register() the mod's common and client entries run. */
    entries: facade ? { common: [`${packageName}.book.${BOOK_RUNTIME.server}`], client: [`${packageName}.book.${BOOK_RUNTIME.client}`] } : { common: [] as string[], client: [] as string[] },
  }
}
