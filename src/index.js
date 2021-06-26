function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      children: children.map((child) =>
        typeof child === 'object' ? child : createTextElement(child),
      ),
    },
  };
}

function createTextElement(text) {
  return {
    type: 'TEXT_ELEMENT',
    props: {
      nodeValue: text,
      children: [],
    },
  };
}

function createDom(fiber) {
  const dom =
    fiber.type === 'TEXT_ELEMENT'
      ? document.createTextNode('')
      : document.createElement(fiber.type);

  updateDom(dom, {}, fiber.props);

  return dom;
}

const isEvent = (key) => key.startsWith('on');
const isProperty = (key) => key !== 'children' && !isEvent(key);
const isNew = (prev, next) => (key) => prev[key] !== next[key];
const isGone = (prev, next) => (key) => !(key in next);
function updateDom(dom, prevProps, nextProps) {
  //Remove old or changed event listeners
  Object.keys(prevProps)
    .filter(isEvent)
    .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      dom.removeEventListener(eventType, prevProps[name]);
    });

  // Remove old properties
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach((name) => {
      dom[name] = '';
    });
  // Set new or changed properties
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      // dom[name] = nextProps[name];
      if (name === 'style') {
        // update style
        transformDomStyle(dom, nextProps.style);
      } else if (name === 'className') {
        // update className
        prevProps.className &&
          dom.classList.remove(...prevProps.className.split(/\s+/));
        dom.classList.add(...nextProps.className.split(/\s+/));
      } else {
        dom[name] = nextProps[name];
      }
    });

  // Add event listeners
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      dom.addEventListener(eventType, nextProps[name]);
    });
}

function cancelEffects(fiber) {
  if (fiber.hooks) {
    fiber.hooks
      .filter((hook) => hook.tag === 'effect' && hook.cancel)
      .forEach((effectHook) => {
        effectHook.cancel();
      });
  }
}

function runEffects(fiber) {
  if (fiber.hooks) {
    fiber.hooks
      .filter((hook) => hook.tag === 'effect' && hook.effect)
      .forEach((effectHook) => {
        effectHook.cancel = effectHook.effect();
      });
  }
}

function commitRoot() {
  deletions.forEach(commitWork);
  // change order
  currentRoot = wipRoot;
  commitWork(wipRoot.child);
  //currentRoot = wipRoot;
  wipRoot = null;
}

function commitWork(fiber) {
  if (!fiber) {
    return;
  }

  let domParentFiber = fiber.parent;
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent;
  }
  const domParent = domParentFiber.dom;

  if (fiber.effectTag === 'PLACEMENT') {
    if (fiber.dom != null) {
      domParent.appendChild(fiber.dom);
    }
    runEffects(fiber);
  } else if (fiber.effectTag === 'UPDATE') {
    cancelEffects(fiber);
    if (fiber.dom != null) {
      updateDom(fiber.dom, fiber.alternate.props, fiber.props);
      domParent.appendChild(fiber.dom);
    }
    runEffects(fiber);
  } else if (fiber.effectTag === 'DELETION') {
    cancelEffects(fiber);
    commitDeletion(fiber, domParent);
    return;
  }
  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

function commitDeletion(fiber, domParent) {
  if (fiber.dom) {
    domParent.removeChild(fiber.dom);
  } else {
    commitDeletion(fiber.child, domParent);
  }
}

function render(element, container) {
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
}

let nextUnitOfWork = null;
let currentRoot = null;
let wipRoot = null;
let deletions = null;

function workLoop(deadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    console.debug(nextUnitOfWork);
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 5;
  }

  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }

  requestIdleCallback(workLoop);
}

requestIdleCallback(workLoop);

function performUnitOfWork(fiber) {
  const isFunctionComponent = fiber.type instanceof Function;
  if (isFunctionComponent) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }
  if (fiber.child) {
    return fiber.child;
  }
  let nextFiber = fiber;
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    nextFiber = nextFiber.parent;
  }
}

let wipFiber = null;
let hookIndex = null;

function updateFunctionComponent(fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  wipFiber.hooks = [];
  const children = [fiber.type(fiber.props)];
  reconcileChildren(fiber, children);
}

function useState(initial) {
  const oldHook =
    wipFiber.alternate &&
    wipFiber.alternate.hooks &&
    wipFiber.alternate.hooks[hookIndex];
  const hook = {
    state: oldHook ? oldHook.state : initial,
    queue: [],
  };

  const actions = oldHook ? oldHook.queue : [];
  actions.forEach((action) => {
    hook.state = typeof action === 'function' ? action(hook.state) : action;
  });

  const setState = (action) => {
    hook.queue.push(action);
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props || {},
      alternate: currentRoot,
    };
    nextUnitOfWork = wipRoot;
    deletions = [];
  };

  wipFiber.hooks.push(hook);
  hookIndex++;
  return [hook.state, setState];
}

const hasDepsChanged = (prevDeps, nextDeps) =>
  !prevDeps ||
  !nextDeps ||
  prevDeps.length !== nextDeps.length ||
  prevDeps.some((dep, index) => dep !== nextDeps[index]);

function useEffect(effect, deps) {
  const oldHook =
    wipFiber.alternate &&
    wipFiber.alternate.hooks &&
    wipFiber.alternate.hooks[hookIndex];

  const hasChanged = hasDepsChanged(oldHook ? oldHook.deps : undefined, deps);

  const hook = {
    tag: 'effect',
    effect: hasChanged ? effect : null,
    cancel: hasChanged && oldHook && oldHook.cancel,
    deps,
  };

  wipFiber.hooks.push(hook);
  hookIndex++;
}

function updateHostComponent(fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  reconcileChildren(fiber, fiber.props.children.flat());
}

function reconcileChildren(wipFiber, elements) {
  let index = 0;
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child;
  let prevSibling = null;

  while (index < elements.length || oldFiber != null) {
    const element = elements[index];
    let newFiber = null;

    const sameType = oldFiber && element && element.type === oldFiber.type;

    if (sameType) {
      newFiber = {
        type: oldFiber.type,
        props: element.props,
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber,
        effectTag: 'UPDATE',
      };
    }
    if (element && !sameType) {
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: 'PLACEMENT',
      };
    }
    if (oldFiber && !sameType) {
      oldFiber.effectTag = 'DELETION';
      deletions.push(oldFiber);
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling;
    }

    if (index === 0) {
      wipFiber.child = newFiber;
    } else if (element) {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
    index++;
  }
}

const reg = /[A-Z]/g;
function transformDomStyle(dom, style) {
  dom.style = Object.keys(style).reduce((acc, styleName) => {
    const key = styleName.replace(reg, function (v) {
      return '-' + v.toLowerCase();
    });
    acc += `${key}: ${style[styleName]};`;
    return acc;
  }, '');
}

const Didact = {
  createElement,
  render,
  useState,
  useEffect,
};

const buttonStyle = { background: '#fff', border: 0 };

/** @jsxRuntime classic */
/** @jsx Didact.createElement */
const Box = ({ items, onFinish, onTodo, onDelete }) => {
  return (
    <div>
      {items.map((data) => (
        <div>
          {onFinish && (
            <button style={buttonStyle} onClick={() => onFinish(data.name)}>
              ✅️
            </button>
          )}
          {onTodo && (
            <button style={buttonStyle} onClick={() => onTodo(data.name)}>
              😜
            </button>
          )}
          {data.name}
          {onDelete && (
            <button style={buttonStyle} onClick={() => onDelete(data.name)}>
              ❌
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

const tabStyle = {};
const tabActiveStyle = { ...tabStyle, fontWeight: 'bold' };

const Tab = ({ active, children, onClick }) => {
  return (
    <span onClick={onClick} style={active ? tabActiveStyle : tabStyle}>
      {children}
    </span>
  );
};

const ItemsKey = 'ItemsKey';
const storeItems = (items, stringify = JSON.stringify) =>
  window.localStorage.setItem(ItemsKey, stringify(items));
const getItems = () => {
  const itemsStr = window.localStorage.getItem(ItemsKey);
  return (itemsStr && JSON.parse(itemsStr)) || [];
};

const App = () => {
  const [state, setState] = Didact.useState('todo');
  const [items, setItems] = Didact.useState([]);
  useEffect(() => {
    console.log(getItems());
    setItems(getItems());
  }, []);
  useEffect(() => {
    console.log('items', items);
  }, [items]);
  const [inputs, setInputs] = Didact.useState('');
  const onToggle = (name) => {
    let currentState = items.find((i) => i.name === name).state;
    items.find((i) => i.name === name).state =
      currentState === 'done' ? 'todo' : 'done';
    setItems([...items]);
  };
  const onDelete = (name) => {
    let index = -1;
    items.forEach((item, i) => {
      if (name === item.name) {
        index = i;
      }
    });
    if (index > -1) {
      items.splice(index, 1);
    }
    setItems([...items]);
  };
  return (
    <div>
      <Tab active={state === 'done'} onClick={() => setState('done')}>
        DONE
      </Tab>
      <Tab active={state === 'todo'} onClick={() => setState('todo')}>
        TODO
      </Tab>
      <Box
        items={items.filter((item) => item.state === state)}
        onFinish={(state === 'todo' && onToggle) || undefined}
        onTodo={(state === 'done' && onToggle) || undefined}
        onDelete={onDelete}
      >
        <div>test</div>
      </Box>
      {inputs}
      <input value={inputs} onChange={(e) => setInputs(e.target.value)} />
      <button
        onClick={() =>
          setItems((items) => [...items, { name: inputs, state: 'todo' }])
        }
      >
        +
      </button>
      <div>
        <button
          onClick={() => {
            storeItems(items);
            alert('saved');
          }}
        >
          save changes
        </button>
      </div>
    </div>
  );
};

const element = <App />;
const container = document.getElementById('root');
Didact.render(element, container);
