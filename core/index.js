import {setAdd, setRightUniq} from './utils.js';
import objectPath from './object-path.js';

class Model {
  constructor(storeId) {
    this.storeId = storeId;
  }
  parents = new Set();
  children = new Set();
  refs = new Map();
  prepared = null

  on = new Set();
}

class Store {
  models = new Map();

  reconciliation(storedId) {
    // todo parent lay
    const parents = new Set(this.models.get(storedId).parents.values());
    const updates = new Set();

    for (const modelId of parents) {
      const model = this.models.get(modelId);
      if (model.parents.size === 0) {
        updates.add(modelId);
        continue;
      }

      for (const parentModelId of model.parents.values()) {
        parents.add(parentModelId);
      }
    }

    for (const modelId of updates) {
      const model = this.models.get(modelId);
      if (model.children.size) {
        for (const childrenModelId of model.children) {
          updates.add(childrenModelId);
        }
      }
    }
  }

  on(storedIds, listener) {
    for (const storeId of storedIds) {
      this.models.get(storeId).on.add(listener);
    }
  }
  parse(data) {
    return this.#parse(data);
  }
  get(storeId) {
    const model = this.models.get(storeId)
    if (model.prepared) {
      return model.prepared
    }
    model.prepared = this.join(storeId)
    return model.prepared
  }
  join(storeId) {
    const model = this.models.get(storeId);
    const templateObj = {};
    for (let i = 0; i < model.template.length; i++) {
      const [path, value] = model.template[i];

      if (Array.isArray(value)) {
        objectPath.set(path, templateObj, []);
      } else if (isObject(value)) {
        objectPath.set(path, templateObj, {});
      } else {
        objectPath.set(path, templateObj, value);
      }
    }

    for (let [path, storeId] of model.refs) {
      const templateObjChild = this.join(this.models.get(storeId).storeId);
      objectPath.set(path, templateObj, templateObjChild);
    }

    return templateObj;
  }
  // todo
  #checkModel(storeId) {
    const idsToCheck = new Set([storeId]);
    for (const storeId of idsToCheck) {
      const model = this.models.get(storeId);
      //todo
      if (model.on.size !== 0 || model.parents.size !== 0) {
        continue;
      }
      if (model.children.size !== 0) {
        setAdd(idsToCheck, model.children);
      }

      this.models.delete(storeId);
    }
  }
  #insertModel(storeId, rawTemplate, parentModelIds) {
    if (!this.models.has(storeId)) {
      this.models.set(storeId, new Model(storeId));
    }

    const currentModel = this.models.get(storeId);

    const oldChildren = currentModel.children;
    currentModel.children = new Set();

    currentModel.refs = this.#parse(rawTemplate, {
      currentModel: currentModel,
      omitNextTemplate: true,
    });

    for (const removedChildId of setRightUniq(currentModel.children, oldChildren)) {
      this.#checkModel(removedChildId);
    }

    if (parentModelIds) {
      setAdd(currentModel.parents, parentModelIds);
    }
  }
  #parse(data, {currentModel, omitNextTemplate = false} = {}) {
    const fields = [[[], data]];
    const template = [];
    const refs = new Map();

    for (let i = 0; i < fields.length; i++) {
      if (i === 1) {
        omitNextTemplate = false;
      }
      const field = fields[i];

      const path = field[0];
      const data = field[1];

      const structureType = getStructureType(data);

      if (structureType === 'primitive') {
        template.push([path, data]);
        continue;
      }
      if (structureType === 'template' && omitNextTemplate === false) {
        const childModelId = getStoreKey(data);

        refs.set(path, childModelId);

        if (currentModel) {
          currentModel.children.add(childModelId);
          this.#insertModel(childModelId, data, [currentModel.storeId]);
        } else {
          this.#insertModel(childModelId, data, []);
        }
        continue;
      }
      if (structureType === 'object' || structureType === 'template') {
        for (let key in data) {
          let pathKey = key;
          if (Array.isArray(data[key])) {
            pathKey = `[]${key}`;
          }
          fields.push([[...path, pathKey], data[key]]);
        }
        if (isEmptyObject(data)) {
          template.push([path, {}]);
        }
        continue;
      }
      if (structureType === 'array') {
        if (data.length === 0) {
          template.push([path, []]);
        }
        for (let i = 0; i < data.length; i++) {
          let key = i;
          if (Array.isArray(data[i])) {
            key = `[]${key}`;
          }
          fields.push([[...path, key], data[key]]);
        }
        continue;
      }
    }

    if (currentModel) {
      currentModel.template = template;
    }

    return refs;
  }
}

// function setResult(path, data, value) {
//   if (path.length === 0) {
//     return;
//   }
//   const lastPath = path[path.length - 1];
//   data[lastPath] = value;
// }

function getStructureType(data) {
  if (Array.isArray(data)) {
    return 'array';
  }
  if (isTemplate(data)) {
    return 'template';
  }
  if (isObject(data)) {
    return 'object';
  }
  return 'primitive';
}

function getStoreKey(template) {
  return `${getTemplateType(template)}:${getTemplateId(template)}`;
}

function getTemplateType(template) {
  return template.__typename;
}

function getTemplateId(template) {
  return template.id;
}

function isEmptyObject(obj) {
  for (const key in obj) {
    return false;
  }
  return true;
}

function isTemplate(data) {
  return !!(getTemplateType(data) && getTemplateId(data));
}

function isObject(data) {
  const prototype = Object.getPrototypeOf(data);
  return !!(prototype === Object.prototype || prototype === null);
}

// function objectSet(path, target, value) {
//   const pathArr = Array.isArray(path) ? path : path.split('.');
//   let entity = target;
//   for (let i = 0; i < pathArr.length; i++) {
//     const currentPath = pathArr[i];
//
//     const isArrPath = currentPath[0] === '[' && currentPath[currentPath.length - 1] === ']';
//     const key = isArrPath ? currentPath.slice(1, -1) : currentPath;
//
//     if (isArrPath && !Array.isArray(entity)) {
//       entity[key] = [];
//     } else if (!entity) {
//       entity[key] = {};
//     }
//
//     if (i === pathArr.length - 1) {
//       entity[key] = value;
//     }
//
//     entity = entity[key];
//   }
// }

// const user = {
//   __typename: 'user',
//   id: '1',
//   bestFriends: [
//     {
//       __typename: 'user',
//       id: '2',
//     },
//     {
//       __typename: 'user',
//       id: '3',
//     },
//   ],
//   enemy: {
//     __typename: 'user',
//     id: '4',
//   },
// };

const user = {
  id: '1',
  name: 'alex',
  __typename: 'user',
  bestFriend: {
    __typename: 'user',
    id: '3',
  },
  friends: {
    1111: {
      id: '2',
      __typename: 'user',
      name: 'sasha',
    },
  },
  comments: [
    {
      id: '1',
      text: 'hi',
      __typename: 'comment',
      articles: {
        __typename: 'article',
        id: '1',
        name: 'this is trump',
      },
    },
    {
      id: '2',
      text: 'bye',
      __typename: 'comment',
    },
  ],
};

const newUser1 = {
  __typename: 'user',
  id: '1',
  name: 'alex svincraft',
  friends: {
    1111: {
      id: '2',
      __typename: 'user',
      name: 'sasha',
    },
  },
};

const newUser2 = {
  id: '2',
  __typename: 'user',
  name: 'sasha bulochka',
};

// const store = new Store();
// // console.time('1');
// const a = store.parse(user);
// // store.parse(newUser1);
// store.parse(newUser2);
// // console.timeEnd('1');
// console.log('-----', 'store.models', store.models);

export default Store;
