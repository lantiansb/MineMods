import {createSignal} from "solid-js"

export const [soundDestination, focusSound] = createSignal<{entity:string;key:string;edit:boolean}|null>(null)
