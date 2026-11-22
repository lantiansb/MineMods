import {test,expect,_electron} from '@playwright/test'
import {mkdir,mkdtemp,writeFile,readdir,readFile} from 'node:fs/promises'
import path from 'node:path'
test('multi-target: packaged target restrictions and storage catalogue cleanup',async()=>{
 const dir=await mkdtemp(path.resolve('../../.artifacts/studio/target-storage-'))
 const runtime=path.join(dir,'runtime')
 for(const folder of ['gradle-home','scene/fabric-1.21.1','reverse-tools']){await mkdir(path.join(runtime,folder),{recursive:true});await writeFile(path.join(runtime,folder,'fixture.bin'),'fixture')}
 await mkdir(path.join(runtime,'store','unused'),{recursive:true});await writeFile(path.join(runtime,'store','unused','fixture.bin'),'unused')
 await writeFile(path.join(runtime,'store','catalog.json'),JSON.stringify({schema_version:1,items:[{id:'tools:unused',kind:'tools',title:'无引用清理夹具',path:'store/unused',bytes:6,source:'fixture',sha256:null,installed_at:new Date().toISOString(),last_used_at:null,users:[]}]}))
 const app=await _electron.launch({executablePath:process.env.STUDIO_PACKAGED_EXECUTABLE!,args:[`--user-data-dir=${path.join(dir,'electron')}`],env:{...process.env,MINEMODS_STUDIO_TEST:'1',MINEMODS_STUDIO_RUNTIME:runtime,MINEMODS_STUDIO_WORKSPACE:path.join(dir,'projects'),OPENAI_API_KEY:'',OPENAI_BASE_URL:''}})
 const page=await app.firstWindow();page.on('dialog',dialog=>void dialog.accept())
 try{
 await expect(page.getByRole('heading',{name:'MineMods',exact:true})).toBeVisible()
 await writeFile(path.join(dir,'identity.json'),JSON.stringify(await app.evaluate(({app})=>({packaged:app.isPackaged,env:process.env.MINEMODS_STUDIO_RUNTIME,path:app.getAppPath()})),null,2))
 await page.getByRole('button',{name:'开始做',exact:true}).click()
 await page.getByRole('button',{name:'改一改',exact:true}).click()
 const card=page.getByRole('region',{name:'游戏和加载器',exact:true})
 for(const [version,loader] of [['1.21.1','NeoForge'],['1.20.1','Forge']]){
 await card.getByLabel('游戏版本',{exact:true}).selectOption(version)
 const radio=card.getByRole('radio',{name:loader,exact:true})
 await expect(radio).toHaveAttribute('aria-disabled','true');await radio.focus();await expect(card.locator('.target-why')).toBeVisible();await expect(card.locator('.target-why')).not.toHaveText('')
 }
 await page.screenshot({path:path.join(dir,'targets.png')})
 await page.getByRole('button',{name:'取消',exact:true}).click()
 await page.getByRole('button',{name:'模组图鉴',exact:true}).click();await page.getByRole('button',{name:'存储空间',exact:true}).click()
 await expect(page.locator('.resource-item').filter({hasText:'反编译工具'})).toHaveCount(1)
 await expect(page.locator('.resource-item').filter({hasText:'测试场游戏文件'})).toContainText('来源：')
 const gradle=page.locator('.resource-item').filter({has:page.getByRole('heading',{name:'Gradle 与打包要用的文件',exact:true})})
 await gradle.getByRole('button',{name:'清理这一项',exact:true}).click();await expect(gradle).toHaveCount(0)
 expect(await readdir(runtime)).not.toContain('gradle-home')
 // An actual saved project names Gradle; cleanup must preserve it as well as project-owned catalogue items.
 const project=await page.evaluate(async()=>{const settings=await window.studio.getSettings();await window.studio.saveSettings({...settings,prepareAhead:false});return window.studio.createProject({name:'仍在用环境的工程',empty:true,description:''})})
 await mkdir(path.join(runtime,'gradle-home'),{recursive:true});await writeFile(path.join(runtime,'gradle-home','fixture.bin'),'used')
 await mkdir(path.join(runtime,'store','used'),{recursive:true});await writeFile(path.join(runtime,'store','used','fixture.bin'),'used')
 const catalogue=JSON.parse(await readFile(path.join(runtime,'store','catalog.json'),'utf8'))
 catalogue.items.push({id:'tools:used',kind:'tools',title:'工程仍在用的清理夹具',path:'store/used',bytes:4,source:'fixture',sha256:null,installed_at:new Date().toISOString(),last_used_at:null,users:[`project:${project.project.id}`]})
 await writeFile(path.join(runtime,'store','catalog.json'),JSON.stringify(catalogue))
 await page.getByRole('button',{name:'清理没用的',exact:true}).click()
 await expect(page.locator('.resource-item').filter({hasText:'无引用清理夹具'})).toHaveCount(0)
 await writeFile(path.join(dir,'storage.json'),JSON.stringify(await page.evaluate(()=>window.studio.listEnvironmentStorage()),null,2));await page.screenshot({path:path.join(dir,'storage.png')})
 await expect(page.locator('.resource-item').filter({hasText:'反编译工具'})).toHaveCount(0)
 expect(await readdir(runtime)).not.toContain('reverse-tools');expect(await readdir(path.join(runtime,'scene'))).toContain('fabric-1.21.1')
 expect(await readFile(path.join(runtime,'gradle-home','fixture.bin'),'utf8')).toBe('used')
 expect(await readFile(path.join(runtime,'store','used','fixture.bin'),'utf8')).toBe('used')
 await expect(page.locator('.resource-item').filter({hasText:'工程仍在用的清理夹具'})).toContainText('仍在用环境的工程')
 await page.screenshot({path:path.join(dir,'storage.png')});await writeFile(path.join(dir,'storage.json'),JSON.stringify(await page.evaluate(()=>window.studio.listEnvironmentStorage()),null,2))
 }finally{await app.close()}
})
