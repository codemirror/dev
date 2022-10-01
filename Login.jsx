import React,{useState,useContext} from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth  } from '../firebaseConfig'
import { AuthContext } from './context/authContext'
import { useNavigate } from 'react-router-dom'
const Login = () => {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const {dispatch} = useContext(AuthContext)
    const navigate = useNavigate()
    const login =(e)=>{
        e.preventDefault()
        signInWithEmailAndPassword(auth, email, password)
        .then((userCredentials)=>{
            const user = userCredentials.user
            dispatch({type:"LOGIN", payload:user });
            navigate("/")
        })
    }

  return (
    <div>
        <form onSubmit={login}>
            <input type="text"  value={email} onChange={(e)=>setEmail(e.target.value)}/>
            <input type="text"  value={password} onChange={(e)=>setPassword(e.target.value)}/>
            <button>Login</button>
        </form>
    </div>
  )
}

export default Login