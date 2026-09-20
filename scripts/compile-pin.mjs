import { compilePinHelper } from "../electron/gadget.mjs";

const exe = await compilePinHelper();
console.log("GadgetPin:", exe);
