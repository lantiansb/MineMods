import type { Project } from "./project"
import type { Finding } from "./reconcile"
import { bookIssues, type BookDocument } from "./book"
export type { BookIssue } from "./book"

/** The books of a project, each with its title. */
export const projectBooks = (project: Pick<Project, "workspace">) =>
  project.workspace.assets.flatMap((asset) => (asset.document.kind === "book" ? [{ id: asset.id, title: asset.title, document: asset.document as BookDocument }] : []))

/** A picture of the project by id, as a page or the look shows it: a texture's size and pixels, or null when it is gone or is something else. */
export const bookPictures = (project: Pick<Project, "workspace">) => (id: string) => {
  const asset = project.workspace.assets.find((candidate) => candidate.id === id)
  return asset?.document.kind === "texture" ? { width: asset.document.width, height: asset.document.height, title: asset.title, texture: asset.document } : null
}

/** 书: every book's issues as findings about it, each pointing at the page field the person can put right. */
export function bookFindings(project: Pick<Project, "workspace">): Finding[] {
  const pictures = bookPictures(project)
  return projectBooks(project).flatMap((book) => bookIssues(book, pictures).map((issue): Finding => {
    const about = { kind: "book" as const, id: book.id, name: book.document.name }
    return { rule: issue.rule, stops: issue.stops, about, text: issue.text, fix: issue.fix, refs: issue.refs, targets: [{ about, field: issue.page === null ? issue.field : `pages.${issue.page}.${issue.field}`, label: issue.page !== null ? `改第 ${issue.page + 1} 页` : issue.field.startsWith("look.") ? "改书的外观" : "改书名" }] }
  }))
}
