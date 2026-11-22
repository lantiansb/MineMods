/**
 * A build, or the assembling of a project for a code check, that stops on something the document says, with the sentence to show.
 *
 * Why this exists: the generator used to stop with a plain `Error` whose message was the sentence. Studio never shows the message of an error it does not know (it may carry a key or a private
 * path), so the sentence was thrown away and the outside AI and the person were told only that the operation had not finished, with a file and a line of Studio's own code: a creature whose
 * ability named a part its model lacked was a mystery, though the build knew exactly what was wrong. An error of this class is the generator saying "these are the words for it": the
 * message is made of the findings' own `text` and `fix` and is what is shown, as it stands. `rule` names the finding it came from, for whoever reads the error in code (never put in the words).
 */
export class BuildStop extends Error {
  constructor(
    readonly rule: string,
    readonly findings: readonly { text: string; fix: string; detail?: string }[],
  ) {
    super(findings.map((finding) => `${finding.text}${finding.fix}`).join(""))
    this.name = "BuildStop"
  }
}
