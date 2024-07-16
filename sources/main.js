import WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import { createCanvas, loadImage } from "canvas";
import path from 'path';
import { fileURLToPath } from 'url';
import { getWallpaper, setWallpaper } from 'wallpaper';
import fs from "fs"

// Wallpaper Plugin Main JS Code 
//a websocket client & server that handle connection with 上位机 and action 

//读取上位机信息
const runtime = process.argv
const [ip, port] = runtime.slice(2, 4)
console.log(`ip and port are ${ip} ${port}`)
//client 
const ws = new WebSocket(`ws://${ip}:${port}`);

//server
let server = undefined;
try {

    server = new WebSocketServer({ port: 3990 })

}
catch (e) {
    console.log("释放端口")
}



let currKey = null; //记录当前正在通信的配置页
let currParam = null; //用来给当前配置页发送的配置
let keyWsMapping = new Map();//key -> ws 
let keyActionMapping = new Map(); //KEY -> ACTIONID
let actionKeyMapping = new Map(); //actionid -> key
let actionUUIDMapping = new Map(); //actionid -> uuid
let actionParamMapping = new Map(); //actionid -> param 
let actionTimerMapping = new Map() //actionid -> rotate-timer info {rotateTimer: int, rotateIdx: int,refreshTimer:int}
let latestWS = null; //最近建立连接的websocket
let latestActionID = null; //最近建立连接的actionID
let actionImageMap = new Map() //{imageList:[], path:, index:}
let activeTimer = null;
let latestOpenSelectID = null;//最近请求打开文件选择的id
let latestOpenSelectWS = null;
//绑定的按键
const uuid = "com.ulanzi.ulanzideck.wallpaper"
const updateFreq = 500


//更新定时器


const __filename = fileURLToPath(import.meta.url);

// 👇️ "/home/john/Desktop/javascript"
const __dirname = path.dirname(__filename);


//插件主程序 接受配置的消息
server.on('connection', function connection(client) {
    //最近建立连接的ws，用来和页面通信
    latestWS = client


    client.on('error', console.error);

    client.on('message', async function message(data) {
        console.log(`页面配置参数`, JSON.parse(data))
        let msg_ = JSON.parse(data)
        if(msg_.url){
            ws.send(JSON.stringify({
                "cmd":"openurl",
                "url":msg_.url,
                "local":false
            }))
            
        }
        if(msg_.openSelect){
            latestOpenSelectID = msg_.id
            latestOpenSelectWS = client
            if(!msg_.useFolder){
                ws.send(JSON.stringify({
                    "cmd":"selectdialog",
                    "type":"file",
                    "filter":"image(*.jpg *.png *.gif)"
                }))
            }
            else{
                ws.send(JSON.stringify({
                    "cmd":"selectdialog",
                    "type":"folder"
                }))
            }

        }
        else{
        //向上位机更新参数
        updateParam(msg_)
        }


    });

    setTimeout(()=>{
        console.log("----向页面发送----",actionParamMapping.get(latestActionID))
        client.send(JSON.stringify(actionParamMapping.get(latestActionID)))
        // latestActionID = undefined
    },1000)


});

let resp;


// Connection opened
ws.addEventListener("open", (event) => {
    //发送建立连接消息
    const hello = {
        "code": 0, // 0-"success" or ⾮0-"fail"
        "cmd": "connected", //连接命令
        "uuid": uuid //插件uuid。同配置⽂件UUID保持⼀致。⽤于区分插件
    }
    ws.send(JSON.stringify(hello))
});
//Connection closed 
ws.addEventListener("close", (event) => {
    server.close()
})

// Listen for messages
ws.addEventListener("message", async (event) => {
    try {
        // console.log("Message from server ", JSON.parse(event.data));
        const data = JSON.parse(event.data)
        const { cmd, uuid, key, param, actionid } = data
        switch (cmd) {
            case "connected":
                //建立连接
                resp = {
                    "code": 0, // 0-"success" or ⾮0-"fail"
                    "cmd": "connected", //连接命令
                    "uuid": uuid //插件uuid。同配置⽂件UUID保持⼀致。⽤于区分插件
                }
                ws.send(JSON.stringify(resp))
                break
            case "run":
                if(activeTimer){
                    clearTimeout(activeTimer)
                }
                //回复
                run(actionid, key,uuid)
                resp = {
                    "code": 0, // 0-"success" or ⾮0-"fail"
                    "cmd": "run",
                    "uuid": uuid, //功能uuid
                    "key": key, //上位机按键key,
                    "actionid": actionid,
                    "param": {}
                }
                ws.send(JSON.stringify(resp))

                break
            case "selectdialog":
                console.log("--------向页面发送文件选择信息----------")
                latestOpenSelectWS.send(JSON.stringify(data))
                break
            
            case "setactive":
                if (data.active) {
                    latestActionID = actionid
                    add(key, actionid, uuid)
                    //如果之前有参数记录，则要发送这个执行结果
                    const prev_param = actionParamMapping.get(actionid)
                    if (prev_param !== undefined) {
                        console.log("存在持久化数据", prev_param)
                    }
                }
                else {
                    //清除所有定时器
                    if (actionTimerMapping.get(actionid)) {
                        clearTimeout(actionTimerMapping.get(actionid))
                        actionTimerMapping.delete(actionid)
                    }
                }


                resp = {
                    "code": 0,
                    "cmd": "setactive",
                    "active": data.active,
                    "uuid": uuid,
                    "key": data.key,
                    "actionid": actionid
                }
                ws.send(JSON.stringify(resp))
                break
            case 'paramfromapp':
                //设置从上位机发来的持久化参数
                paramfromapp(param, actionid, key, uuid)


                //回复
                resp = {
                    "cmd": "paramfromapp",
                    "uuid": uuid, //功能uuid
                    "key": key, //上位机按键key
                    "actionid": actionid,
                    "param": {}
                }
                ws.send(JSON.stringify(resp))
                break

            case "add":

                //把插件某个功能配置到按键上
                add(key, actionid, uuid)
                latestActionID = actionid
                // 持久化数据
                paramfromapp(param, actionid, key, uuid)


                resp = {
                    "code": 0, // 0-"success" or ⾮0-"fail"
                    "cmd": "add",
                    "uuid": uuid, //功能uuid
                    "key": key, //上位机按键key
                    "actionid": actionid,
                    "param": {}
                }
                ws.send(JSON.stringify(resp))
                break
            case "init":
                break

            case "clearall":
                break

            case "clear":
                //清除配置信息，定时器
                let clearID = param[0].actionid
                if(actionImageMap.get(clearID)){
                    clearTimeout(actionImageMap.get(clearID).timer)
                }
                actionKeyMapping.delete(clearID)
                actionUUIDMapping.delete(clearID)
                actionParamMapping.delete(clearID)
                resp = {
                    "code": 0, // 0-"success" or ⾮0-"fail"
                    "cmd": "clear",
                    "param": [
                        {
                            "uuid": param[0].uuid, //功能uuid
                            "key": param[0].key, //上位机按键key
                            "actionid": clearID//功能实例uuid
                        }]

                }
                break
            case "paramfromplugin":
                console.log("[paramfromplugin]", event.data)

        }

    }
    catch (e) {
        console.log("error parsing message", e)
    }

})

//执行插件功能
//param: 本次的配置，actionid:对应的实例
// fromPress:是否是按键
async function run(actionid, key, uuid) {
    //make request 
    const param = actionParamMapping.get(actionid)
    console.log("[run] on param", param)
    if(actionImageMap.get(actionid)){
        clearTimeout(actionImageMap.get(actionid).timer)
    }
    //check if path is a image or not 
    if(/(\.jpg|\.png|\.jpeg)$/.test(param.filePath)){
        await setWallpaper(param.filePath, { screen: "all" });
        const icon = await drawIcon(param.filePath)
        if(icon) updateIcon(icon, key, uuid)

    }
    else{
        if(actionImageMap.get(actionid) && !actionImageMap.get(actionid).pause){
            actionImageMap.get(actionid).pause = true 
            return 
        }
        const imageList = []

        fs.readdir(param.filePath, async (err, files) => {
            console.log("-------目录下文件---------\n")
            files.forEach(file => {
                if(/(jpg|png|jpeg)$/.test(file)){
                    console.log(file);
                    imageList.push(file)
                }
            });
            if(!/\/$/.test(param.filePath)){
                param.filePath = param.filePath + "/"
            }
            actionImageMap.set(actionid,{imageList:imageList,index:0,path:param.filePath})
            //immediately update once 
            if(imageList.length){
                const imagePath = param.filePath+imageList[0]
                actionImageMap.get(actionid).index+=1
                await setWallpaper(imagePath, { screen: "all" });
                const icon = await drawIcon(imagePath)
                if(icon) {
                    
                    updateIcon(icon, key, uuid)
                }
            
               
            }
            periodUpdateImage(actionid,param.key,param.uuid,param.gap,param.random)
          });
          
    }
}

function periodUpdateImage(actionid,key,uuid,gap,random){
    
    const map = actionImageMap.get(actionid)
    if(map.pause) return 
    let timer = setTimeout(async()=>{
        
        let index;  
        if(random){
            index = getRandomInt(0,map.imageList.length-1)
        }
        else{
            index = map.index % map.imageList.length
        }
        const imagePath = map.path+map.imageList[index]
        if(!random) actionImageMap.get(actionid).index+=1
        console.log("---------更新桌面---------",imagePath,"\n")
        await setWallpaper(imagePath, { screen: "all" });
        const icon = await drawIcon(imagePath)
        if(icon) updateIcon(icon, key, uuid)
        
        periodUpdateImage(actionid,key,uuid,gap,random)


    },gap*1000)
    map.timer = timer
    activeTimer = timer
}

function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function drawIcon(filePath) {
    let w = 256, h = 256
    let offScreenCanvas = createCanvas(w, h);
    let context = offScreenCanvas.getContext("2d");

    const bgImage = await loadImage(__dirname + "/screen.png")

    context.drawImage(bgImage, 0, 0);
    let wallPaper
    try{

        wallPaper = await loadImage(filePath)
    }
    catch(err){
        console.log(`---------读取图片 ${filePath}出错-------------`,err)
        return undefined
    }
    context.drawImage(wallPaper, 18, 48, 220, 160);
    const image = offScreenCanvas.toDataURL("image/png")
    return image
}


function setTimeoutUpdate(func, actionid) {
    if (!actionTimerMapping.get(actionid)) {
        return
    }
    clearTimeout(actionTimerMapping.get(actionid))
    let timer = setTimeout(() => {
        console.log("定时跟踪")
        func()
        setTimeoutUpdate(func, actionid)
    }, updateFreq)
    actionTimerMapping.set(actionid, timer)

}


function drawImage(data, param, fromPress = false) {
    const rgbData = data.split(" ")
    let w = 256, h = 256

    const image = offScreenCanvas.toDataURL("image/png")
    return image

}


//把插件功能配置到按键上
function add(key, actionid, uuid) {
    //当前正在通信的key，用来对应websocket
    currKey = key
    // 将刚刚建立连接的socket连接上
    keyWsMapping.set(currKey, latestWS)
    //记录与该件绑定的actionid
    keyActionMapping.set(currKey, actionid)
    actionUUIDMapping.set(actionid, uuid)
    actionKeyMapping.set(actionid, key)

}
//传递参数给插件
async function paramfromapp(param, actionid, key, uuid) {
    if (Object.entries(param).length == 0) {
        currParam = {}

    }
    else {
        //将会发送给配置页面
        currParam = param
        //如果初次数据就不为空，执行一次
        // const image = run(param, actionid)

    }


    //将对应的key和配置发送给配置页面
    let initialMsg = {
        "cmd": "paramfromplugin",
        "uuid": uuid, //功能uuid
        "param": currParam, //持久化的参数,
        "actionid": actionid,
        "key": key
    }
    if (!actionParamMapping.get(actionid)) {
        actionParamMapping.set(actionid, { ...param, actionid: actionid, key: key, uuid: uuid })
    }
    console.log("-----------paramfromapp------------", actionParamMapping.get(actionid))
    // if (latestWS) {
    //     latestWS.send(JSON.stringify(actionParamMapping.get(actionid)))
    // }

}

//插件状态初始化
function init() {

}
//清理插件的功能配置
function clearAll() {

}
//移除单个配置信息
function clear() {

}
// 插件->上位机
//插件更新参数
async function updateParam(param) {
    console.log("[updateParam]", param.key, param.actionid)
    const { key, actionid, uuid } = param
    //写入map
    actionParamMapping.set(param.actionid, param)
    //更新一次

    const msg = {
        "cmd": "paramfromplugin",
        "uuid": uuid, //功能uuid
        "key": key, //上位机按键key
        "param": param,
        "actionid": actionid
    }

    ws.send(JSON.stringify(msg))
}

//插件更新图标
async function updateIcon(data, key, uuid) {
    console.log(`updateIcon key ${key} actionid ${keyActionMapping.get(key)}`)
    const msg = {
        "cmd": "state",
        "param": {//图标状态更换，若⽆则为空
            "statelist": [
                {
                    "uuid": uuid, //功能uuid,
                    "actionid": keyActionMapping.get(key),
                    "key": key,
                    "type": 1,
                    "state": 1, // 图标列表数组编号。请对照manifest.json
                    "data": data, // ⾃定义图标base64编码数据
                    "path": "" //本地图⽚⽂件
                }
            ]
        }
    }
    ws.send(JSON.stringify(msg))
}


//clean up 
function exitHandler(options, exitCode) {
    if (exitCode || exitCode === 0) console.log("退出", exitCode);

    //shut down ws server
    if (options.exit) process.exit();
}

// do something when app is closing
process.on('exit', exitHandler.bind(null, { exit: true }));

// catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, { exit: true }));

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, { exit: true }));
process.on('SIGUSR2', exitHandler.bind(null, { exit: true }));

// catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, { exit: true }));
